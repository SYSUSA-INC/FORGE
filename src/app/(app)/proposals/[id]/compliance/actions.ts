"use server";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  complianceItemEvidence,
  complianceItems,
  knowledgeEntries,
  organizations,
  proposalSections,
  proposals,
  type ComplianceAIAssessment,
  type ComplianceCategory,
  type ComplianceEvidenceKind,
  type ComplianceOwnerStatus,
  type ComplianceStatus,
  type TipTapDoc,
} from "@/db/schema";
import { completeForTenant } from "@/lib/ai";
import {
  buildComplianceAutoMapPrompt,
  buildCompliancePreflightPrompt,
  complianceAutoMapResponseSchema,
  compliancePreflightResponseSchema,
  parseAiJson,
  type ComplianceAutoMapVerdict,
  type CompliancePreflightItem,
  type CompliancePreflightVerdict,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { projectToPlain } from "@/lib/tiptap-doc";
import { log } from "@/lib/log";

async function ownsProposal(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return !!row;
}

/**
 * Verify that a proposalSectionId (if provided) belongs to the given
 * proposal. Prevents cross-proposal/cross-tenant section references
 * being injected into compliance item rows.
 */
async function sectionBelongsToProposal(
  sectionId: string | null | undefined,
  proposalId: string,
): Promise<boolean> {
  if (!sectionId) return true;
  const [row] = await db
    .select({ id: proposalSections.id })
    .from(proposalSections)
    .where(
      and(
        eq(proposalSections.id, sectionId),
        eq(proposalSections.proposalId, proposalId),
      ),
    )
    .limit(1);
  return !!row;
}

export type ComplianceItemInput = {
  category: ComplianceCategory;
  number: string;
  requirementText: string;
  volume: string;
  rfpPageReference: string;
  proposalSectionId: string | null;
  proposalPageReference: string;
  status: ComplianceStatus;
  notes: string;
  ownerUserId: string | null;
  ownerStatus?: ComplianceOwnerStatus;
};

export async function createComplianceItemAction(
  proposalId: string,
  input: ComplianceItemInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (!input.requirementText.trim()) {
    return { ok: false, error: "Requirement text is required." };
  }
  if (!(await sectionBelongsToProposal(input.proposalSectionId, proposalId))) {
    return {
      ok: false,
      error: "Section does not belong to this proposal.",
    };
  }

  try {
    const [maxOrder] = await db
      .select({ max: complianceItems.ordering })
      .from(complianceItems)
      .where(eq(complianceItems.proposalId, proposalId))
      .orderBy(desc(complianceItems.ordering))
      .limit(1);

    const [row] = await db
      .insert(complianceItems)
      .values({
        proposalId,
        category: input.category,
        number: input.number.trim(),
        requirementText: input.requirementText.trim(),
        volume: input.volume.trim(),
        rfpPageReference: input.rfpPageReference.trim(),
        proposalSectionId: input.proposalSectionId,
        proposalPageReference: input.proposalPageReference.trim(),
        status: input.status,
        notes: input.notes.trim(),
        ordering: (maxOrder?.max ?? 0) + 1,
        ownerUserId: input.ownerUserId,
        ownerStatus: input.ownerUserId ? (input.ownerStatus ?? "assigned") : "unassigned",
        createdByUserId: actor.id,
      })
      .returning({ id: complianceItems.id });
    if (!row) return { ok: false, error: "Could not create item." };

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.compliance.create",
      resourceType: "compliance_item",
      resourceId: row.id,
      metadata: {
        proposalId,
        category: input.category,
        number: input.number,
      },
    });

    revalidatePath(`/proposals/${proposalId}/compliance`);
    return { ok: true, id: row.id };
  } catch (err) {
    log.error("[createComplianceItemAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function updateComplianceItemAction(
  proposalId: string,
  itemId: string,
  input: Partial<ComplianceItemInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (
    input.proposalSectionId !== undefined &&
    !(await sectionBelongsToProposal(input.proposalSectionId, proposalId))
  ) {
    return {
      ok: false,
      error: "Section does not belong to this proposal.",
    };
  }

  try {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.category !== undefined) update.category = input.category;
    if (input.number !== undefined) update.number = input.number.trim();
    if (input.requirementText !== undefined)
      update.requirementText = input.requirementText.trim();
    if (input.volume !== undefined) update.volume = input.volume.trim();
    if (input.rfpPageReference !== undefined)
      update.rfpPageReference = input.rfpPageReference.trim();
    if (input.proposalSectionId !== undefined)
      update.proposalSectionId = input.proposalSectionId;
    if (input.proposalPageReference !== undefined)
      update.proposalPageReference = input.proposalPageReference.trim();
    if (input.status !== undefined) update.status = input.status;
    if (input.notes !== undefined) update.notes = input.notes.trim();
    if (input.ownerUserId !== undefined) {
      update.ownerUserId = input.ownerUserId;
      // When clearing the owner, reset owner status to unassigned.
      if (!input.ownerUserId && input.ownerStatus === undefined) {
        update.ownerStatus = "unassigned";
      }
    }
    if (input.ownerStatus !== undefined) update.ownerStatus = input.ownerStatus;

    await db
      .update(complianceItems)
      .set(update)
      .where(
        and(
          eq(complianceItems.id, itemId),
          eq(complianceItems.proposalId, proposalId),
        ),
      );

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.compliance.update",
      resourceType: "compliance_item",
      resourceId: itemId,
      metadata: { proposalId, fields: Object.keys(input) },
    });

    revalidatePath(`/proposals/${proposalId}/compliance`);
    return { ok: true };
  } catch (err) {
    log.error("[updateComplianceItemAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function deleteComplianceItemAction(
  proposalId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  await db
    .delete(complianceItems)
    .where(
      and(
        eq(complianceItems.id, itemId),
        eq(complianceItems.proposalId, proposalId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.delete",
    resourceType: "compliance_item",
    resourceId: itemId,
    metadata: { proposalId },
  });
  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true };
}

export async function bulkImportComplianceItemsAction(
  proposalId: string,
  input: {
    category: ComplianceCategory;
    lines: string[];
  },
): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  const cleaned = input.lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (cleaned.length === 0) {
    return { ok: false, error: "No lines to import." };
  }

  const [maxOrder] = await db
    .select({ max: complianceItems.ordering })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId))
    .orderBy(desc(complianceItems.ordering))
    .limit(1);
  let order = (maxOrder?.max ?? 0) + 1;

  // naive parse: "L.3.2 The contractor shall..." or "M-1: ..."
  const split = cleaned.map((line) => {
    const m = line.match(/^([A-Z][\w.\-]*)\s+(.*)$/);
    if (m && m[1] && m[2]) return { number: m[1], requirementText: m[2] };
    const m2 = line.match(/^([A-Z][\w.\-]*)[:.\-]\s*(.*)$/);
    if (m2 && m2[1] && m2[2]) return { number: m2[1], requirementText: m2[2] };
    return { number: "", requirementText: line };
  });

  await db.insert(complianceItems).values(
    split.map((s) => ({
      proposalId,
      category: input.category,
      number: s.number,
      requirementText: s.requirementText,
      ordering: order++,
      createdByUserId: actor.id,
    })),
  );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.bulk_import",
    resourceType: "compliance_item",
    resourceId: proposalId,
    metadata: {
      proposalId,
      category: input.category,
      imported: cleaned.length,
    },
  });

  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true, imported: cleaned.length };
}

// ────────────────────────────────────────────────────────────────────
// Phase 14c — compliance pre-flight
// ────────────────────────────────────────────────────────────────────

export type CompliancePreflightResult =
  | {
      ok: true;
      assessed: number;
      unmapped: number;
      stubbed: boolean;
      provider: string;
    }
  | { ok: false; error: string };

const PREFLIGHT_VERDICT_STATUSES: Set<ComplianceStatus> = new Set([
  "complete",
  "partial",
  "not_addressed",
  "not_applicable",
]);
const PREFLIGHT_CONFIDENCE: Set<"high" | "medium" | "low"> = new Set([
  "high",
  "medium",
  "low",
]);

/**
 * Run the AI pre-flight against every compliance item that's mapped
 * to a proposal section. Items without a section mapping are
 * skipped — the AI has no draft to read for them, so a verdict
 * would be hallucinated.
 *
 * Batches by section so the same section body isn't shipped per-item.
 * Each AI call returns one verdict per item in that section's group.
 *
 * Idempotent: safe to re-run. Each call overwrites the previous
 * aiAssessment + aiAssessedAt for the items it touches.
 */
export async function runCompliancePreflightAction(
  proposalId: string,
): Promise<CompliancePreflightResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  // BL-16 Phase B-2 — gate compliance preflight on `complianceMatrix`.
  // The flag covers both the compliance matrix UI (always-visible for
  // now) and this AI-powered preflight assessment.
  //
  // BL-16 Phase B-3b — bump the AI-request counter since preflight
  // makes one or more AI calls.
  try {
    await ensureFeature(organizationId, "complianceMatrix");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  // Rate limit per proposal — pre-flight is expensive (one AI call
  // per section group). 10 runs/hour per proposal is generous for
  // legitimate iteration but stops a stuck client retry loop.
  const limit = await enforceRateLimit({
    key: `preflight:proposal:${proposalId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    // BL-16 Phase B-3d — rate-limited before any AI work; refund the slot.
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Pre-flight limit (10/hour) reached for this proposal. Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  // Pull every mapped item + the section it's mapped to.
  const rows = await db
    .select({
      itemId: complianceItems.id,
      number: complianceItems.number,
      category: complianceItems.category,
      requirementText: complianceItems.requirementText,
      sectionId: complianceItems.proposalSectionId,
      sectionTitle: proposalSections.title,
      sectionKind: proposalSections.kind,
      sectionBodyDoc: proposalSections.bodyDoc,
    })
    .from(complianceItems)
    .innerJoin(
      proposalSections,
      eq(proposalSections.id, complianceItems.proposalSectionId),
    )
    .where(
      and(
        eq(complianceItems.proposalId, proposalId),
        isNotNull(complianceItems.proposalSectionId),
      ),
    );

  // Count items that exist but aren't mapped — surfaced in the result
  // so the UI can prompt the user to map before re-running.
  const [unmappedRow] = await db
    .select({ count: complianceItems.id })
    .from(complianceItems)
    .where(
      and(
        eq(complianceItems.proposalId, proposalId),
        // unmapped if proposalSectionId is null
        // (Drizzle exposes IS NULL via isNull but we already counted
        // mapped above; a single SELECT count(*) works too)
      ),
    );
  void unmappedRow;
  const allCountRows = await db
    .select({ id: complianceItems.id, mapped: complianceItems.proposalSectionId })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId));
  const unmapped = allCountRows.filter((r) => !r.mapped).length;

  if (rows.length === 0) {
    // BL-16 Phase B-3d — no mapped items, so no AI call will run.
    // Refund the upfront slot charge.
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: true,
      assessed: 0,
      unmapped,
      stubbed: false,
      provider: "stub",
    };
  }

  // Group items by section.
  const bySection = new Map<
    string,
    {
      sectionTitle: string;
      sectionKind: string;
      sectionBody: string;
      items: CompliancePreflightItem[];
    }
  >();
  for (const r of rows) {
    if (!r.sectionId) continue;
    const plain = projectToPlain(r.sectionBodyDoc as TipTapDoc | null);
    const group = bySection.get(r.sectionId);
    if (group) {
      group.items.push({
        id: r.itemId,
        number: r.number,
        category: r.category,
        requirementText: r.requirementText,
      });
    } else {
      bySection.set(r.sectionId, {
        sectionTitle: r.sectionTitle,
        sectionKind: r.sectionKind,
        sectionBody: plain,
        items: [
          {
            id: r.itemId,
            number: r.number,
            category: r.category,
            requirementText: r.requirementText,
          },
        ],
      });
    }
  }

  let assessed = 0;
  let stubbed = false;
  let provider = "stub";
  const now = new Date();

  for (const group of bySection.values()) {
    const prompt = buildCompliancePreflightPrompt({
      sectionTitle: group.sectionTitle,
      sectionKind: group.sectionKind,
      sectionBody: group.sectionBody,
      items: group.items,
    });

    let raw = "";
    try {
      const res = await completeForTenant({
        organizationId,
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: 2000,
        temperature: 0,
      });
      raw = res.text;
      stubbed = stubbed || res.stubbed;
      provider = res.provider;
    } catch (err) {
      log.warn("[runCompliancePreflightAction]", "AI call failed", { error: err });
      continue;
    }

    const parseResult = parseAiJson(raw, compliancePreflightResponseSchema);
    if (!parseResult.ok) {
      log.warn("[runCompliancePreflightAction]", "JSON parse failed", {
        parseError: parseResult.error,
        rawSnippet: raw.slice(0, 240),
      });
      continue;
    }
    const verdicts: CompliancePreflightVerdict[] = parseResult.data.verdicts;

    // Apply each verdict back to its item, sequentially per Neon rule.
    for (const v of verdicts) {
      if (
        !PREFLIGHT_VERDICT_STATUSES.has(v.suggestedStatus) ||
        !PREFLIGHT_CONFIDENCE.has(v.confidence)
      ) {
        continue;
      }
      // Verify the item belongs to this proposal — guard against
      // hallucinated ids that don't match anything.
      const inGroup = group.items.find((it) => it.id === v.itemId);
      if (!inGroup) continue;

      const assessment: ComplianceAIAssessment = {
        suggestedStatus: v.suggestedStatus,
        confidence: v.confidence,
        gap: v.gap.slice(0, 600),
        suggestion: v.suggestion.slice(0, 600),
        model: provider,
      };

      // Concurrent-write guard: only overwrite if the row's previous
      // aiAssessedAt is null or older than 5 seconds. Stops a double-
      // clicked pre-flight run from clobbering an in-flight result and
      // burning tokens on conflicting verdicts.
      const result = await db
        .update(complianceItems)
        .set({
          aiAssessment: assessment,
          aiAssessedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(complianceItems.id, v.itemId),
            eq(complianceItems.proposalId, proposalId),
            sql`(${complianceItems.aiAssessedAt} IS NULL OR ${complianceItems.aiAssessedAt} < now() - interval '5 seconds')`,
          ),
        )
        .returning({ id: complianceItems.id });
      // If the guard prevented the update (concurrent run already won),
      // result is empty — that's fine, we just skip the count.
      if (result.length > 0) assessed += 1;
    }
  }

  // BL-16 Phase B-3d — refund the request slot when the entire preflight
  // produced no assessments (every section's AI call failed or every
  // verdict was rejected). The user got zero value; don't burn the slot.
  // If even one section was assessed, the preflight did real work — keep
  // the charge.
  if (assessed === 0) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.preflight.run",
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: { assessed, unmapped, stubbed, provider },
  });

  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true, assessed, unmapped, stubbed, provider };
}

/**
 * Apply the AI's suggested status to a compliance item — equivalent
 * to the user clicking "Accept AI suggestion" on a row. Clears the
 * aiAssessment so the UI badge goes away once accepted.
 */
export async function acceptComplianceAIAssessmentAction(
  proposalId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  const [row] = await db
    .select({
      assessment: complianceItems.aiAssessment,
    })
    .from(complianceItems)
    .where(
      and(
        eq(complianceItems.id, itemId),
        eq(complianceItems.proposalId, proposalId),
      ),
    )
    .limit(1);

  if (!row || !row.assessment) {
    return { ok: false, error: "No AI assessment to accept." };
  }

  await db
    .update(complianceItems)
    .set({
      status: row.assessment.suggestedStatus,
      aiAssessment: null,
      aiAssessedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(complianceItems.id, itemId),
        eq(complianceItems.proposalId, proposalId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.ai_accept",
    resourceType: "compliance_item",
    resourceId: itemId,
    metadata: {
      proposalId,
      acceptedStatus: row.assessment.suggestedStatus,
    },
  });

  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true };
}

/**
 * Dismiss the AI's suggestion without changing the human-set status.
 */
export async function dismissComplianceAIAssessmentAction(
  proposalId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  await db
    .update(complianceItems)
    .set({
      aiAssessment: null,
      aiAssessedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(complianceItems.id, itemId),
        eq(complianceItems.proposalId, proposalId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.ai_dismiss",
    resourceType: "compliance_item",
    resourceId: itemId,
    metadata: { proposalId },
  });
  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// BL-FB-CM-AUTOMAP — Auto-map compliance items to proposal sections
// ────────────────────────────────────────────────────────────────────

export type AutoMapSuggestion = {
  itemId: string;
  itemNumber: string;
  itemText: string;
  currentSectionId: string | null;
  suggestedSectionId: string;
  suggestedSectionTitle: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

export type RunComplianceAutoMapResult =
  | {
      ok: true;
      suggestions: AutoMapSuggestion[];
      unchanged: number;
      stubbed: boolean;
      model: string;
    }
  | { ok: false; error: string };

const AUTOMAP_CONFIDENCE: Set<"high" | "medium" | "low"> = new Set([
  "high",
  "medium",
  "low",
]);

/**
 * BL-FB-CM-AUTOMAP — Phase 1.
 *
 * Asks the AI to map every compliance item to the best-fit proposal
 * section. Returns a suggestion list (does NOT write to DB on its own —
 * the user reviews and applies). Each suggestion carries a confidence
 * level so the UI can render an "Accept all high-confidence" affordance.
 *
 * Rate-limited 5/hour per proposal. AI quota counted per attempt;
 * refunded on early failure (no AI call) or empty result.
 */
export async function runComplianceAutoMapAction(
  proposalId: string,
): Promise<RunComplianceAutoMapResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  try {
    await ensureFeature(organizationId, "complianceMatrix");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const limit = await enforceRateLimit({
    key: `automap:proposal:${proposalId}`,
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Auto-map limit (5/hour) reached for this proposal. Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  const items = await db
    .select({
      id: complianceItems.id,
      number: complianceItems.number,
      category: complianceItems.category,
      requirementText: complianceItems.requirementText,
      proposalSectionId: complianceItems.proposalSectionId,
    })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId))
    .orderBy(asc(complianceItems.ordering));

  const sections = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      kind: proposalSections.kind,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  if (items.length === 0) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: "No compliance items to map. Import or add items first.",
    };
  }
  if (sections.length === 0) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: "Proposal has no sections to map to. Add sections first.",
    };
  }

  // Cap items per call to keep prompts in bounds. 80 items per request
  // is well within Anthropic limits and covers nearly every proposal.
  const ITEMS_PER_BATCH = 80;
  const sectionLookup = new Map(sections.map((s) => [s.id, s.title]));

  let stubbed = false;
  let model = "stub";
  const aggregated: ComplianceAutoMapVerdict[] = [];

  for (let i = 0; i < items.length; i += ITEMS_PER_BATCH) {
    const batch = items.slice(i, i + ITEMS_PER_BATCH);
    const prompt = buildComplianceAutoMapPrompt({
      items: batch.map((it) => ({
        itemId: it.id,
        number: it.number,
        category: it.category,
        requirementText: it.requirementText,
      })),
      sections: sections.map((s) => ({
        sectionId: s.id,
        title: s.title,
        kind: s.kind,
      })),
    });

    let raw = "";
    try {
      const res = await completeForTenant({
        organizationId,
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: 3000,
        temperature: 0,
        cacheSystem: true,
      });
      raw = res.text;
      stubbed = stubbed || res.stubbed;
      model = `${res.provider}:${res.model}`;
    } catch (err) {
      log.warn("[runComplianceAutoMapAction]", "AI call failed", { error: err });
      continue;
    }

    const parseResult = parseAiJson(raw, complianceAutoMapResponseSchema);
    if (!parseResult.ok) {
      log.warn("[runComplianceAutoMapAction]", "JSON parse failed", {
        parseError: parseResult.error,
        rawSnippet: raw.slice(0, 240),
      });
      continue;
    }
    aggregated.push(...parseResult.data.mappings);
  }

  if (aggregated.length === 0) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error:
        "AI returned no usable mappings. Re-run, or check the AI provider configuration.",
    };
  }

  // Build suggestions, filtering invalid section ids + low-quality entries.
  const validSectionIds = new Set(sections.map((s) => s.id));
  const itemIndex = new Map(items.map((it) => [it.id, it]));
  const suggestions: AutoMapSuggestion[] = [];
  let unchanged = 0;

  for (const v of aggregated) {
    if (!AUTOMAP_CONFIDENCE.has(v.confidence)) continue;
    const item = itemIndex.get(v.itemId);
    if (!item) continue;

    // Empty sectionId means AI declined to map — skip and let the
    // user map manually.
    if (!v.sectionId) continue;
    if (!validSectionIds.has(v.sectionId)) continue;

    // If the AI's suggestion matches the current mapping, count as
    // unchanged so the UI can summarize "AI confirmed N mappings,
    // suggests M changes".
    if (item.proposalSectionId === v.sectionId) {
      unchanged += 1;
      continue;
    }

    suggestions.push({
      itemId: v.itemId,
      itemNumber: item.number,
      itemText: item.requirementText.slice(0, 240),
      currentSectionId: item.proposalSectionId ?? null,
      suggestedSectionId: v.sectionId,
      suggestedSectionTitle: sectionLookup.get(v.sectionId) ?? "(unknown)",
      confidence: v.confidence,
      rationale: v.rationale.slice(0, 240),
    });
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.automap.run",
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: {
      proposalId,
      totalItems: items.length,
      suggestionCount: suggestions.length,
      unchanged,
      stubbed,
      model,
    },
  });

  return { ok: true, suggestions, unchanged, stubbed, model };
}

/**
 * Apply a set of auto-map suggestions. Used by the "Accept all high-
 * confidence" button or per-row apply. Caller passes the itemId →
 * sectionId pairs they want to commit.
 */
export async function applyComplianceAutoMapAction(
  proposalId: string,
  mappings: { itemId: string; sectionId: string }[],
): Promise<
  { ok: true; applied: number } | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (mappings.length === 0) {
    return { ok: true, applied: 0 };
  }

  // Validate every section id belongs to this proposal — refuse the
  // whole batch on any cross-proposal section reference.
  const sectionIds = Array.from(new Set(mappings.map((m) => m.sectionId)));
  const sectionRows = await db
    .select({ id: proposalSections.id })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId));
  const validIds = new Set(sectionRows.map((r) => r.id));
  for (const sid of sectionIds) {
    if (!validIds.has(sid)) {
      return {
        ok: false,
        error: "One or more sections do not belong to this proposal.",
      };
    }
  }

  // Apply sequentially per Neon-pgbouncer rule.
  let applied = 0;
  const now = new Date();
  for (const m of mappings) {
    const r = await db
      .update(complianceItems)
      .set({ proposalSectionId: m.sectionId, updatedAt: now })
      .where(
        and(
          eq(complianceItems.id, m.itemId),
          eq(complianceItems.proposalId, proposalId),
        ),
      )
      .returning({ id: complianceItems.id });
    if (r.length > 0) applied += 1;
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.automap.apply",
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: { proposalId, requested: mappings.length, applied },
  });

  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true, applied };
}

// ────────────────────────────────────────────────────────────────────
// BL-FB-CM-EVIDENCE — per-row evidence linking
// ────────────────────────────────────────────────────────────────────

export type EvidenceRow = {
  id: string;
  kind: ComplianceEvidenceKind;
  refId: string;
  label: string;
  snippet: string;
  createdAt: string;
};

export type AvailableEvidence = {
  pastPerformance: {
    refId: string;
    customer: string;
    contract: string;
    description: string;
  }[];
  knowledgeEntries: {
    id: string;
    kind: string;
    title: string;
    body: string;
  }[];
  sections: {
    id: string;
    title: string;
    ordering: number;
    contentSnippets: string[];
  }[];
};

/**
 * Owns the proposal AND the compliance item belongs to that proposal.
 * Used to gate writes against cross-proposal item ids.
 */
async function ownsComplianceItem(
  itemId: string,
  organizationId: string,
): Promise<{ ok: true; proposalId: string } | { ok: false }> {
  const [row] = await db
    .select({
      itemId: complianceItems.id,
      proposalId: complianceItems.proposalId,
    })
    .from(complianceItems)
    .innerJoin(proposals, eq(proposals.id, complianceItems.proposalId))
    .where(
      and(
        eq(complianceItems.id, itemId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false };
  return { ok: true, proposalId: row.proposalId };
}

export async function listAvailableEvidenceAction(
  proposalId: string,
): Promise<
  { ok: true; data: AvailableEvidence } | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  const [orgRow] = await db
    .select({ pastPerformance: organizations.pastPerformance })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  // Past performance lives as an array of jsonb objects on the org;
  // each entry has a stable `id` we'll use as refId.
  const pastPerformance = (orgRow?.pastPerformance ?? [])
    .filter((p) => p && (p.customer || p.contract || p.description))
    .map((p) => ({
      refId: p.id,
      customer: p.customer ?? "",
      contract: p.contract ?? "",
      description: (p.description ?? "").slice(0, 400),
    }));

  const knowledge = await db
    .select({
      id: knowledgeEntries.id,
      kind: knowledgeEntries.kind,
      title: knowledgeEntries.title,
      body: knowledgeEntries.body,
    })
    .from(knowledgeEntries)
    .where(eq(knowledgeEntries.organizationId, organizationId))
    .orderBy(asc(knowledgeEntries.title))
    .limit(200);

  const sectionRows = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
      bodyDoc: proposalSections.bodyDoc,
      content: proposalSections.content,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  // Break each section's plain text into paragraph-sized snippets so
  // the picker can show pickable paragraphs (rather than full sections).
  const sections = sectionRows.map((s) => {
    const plain =
      projectToPlain(s.bodyDoc as TipTapDoc | null) || s.content || "";
    const paragraphs = plain
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40)
      .slice(0, 25);
    return {
      id: s.id,
      title: s.title,
      ordering: s.ordering,
      contentSnippets: paragraphs.map((p) => p.slice(0, 500)),
    };
  });

  return {
    ok: true,
    data: {
      pastPerformance,
      knowledgeEntries: knowledge.map((k) => ({
        id: k.id,
        kind: k.kind,
        title: k.title,
        body: k.body.slice(0, 1000),
      })),
      sections,
    },
  };
}

export async function attachComplianceEvidenceAction(input: {
  proposalId: string;
  itemId: string;
  kind: ComplianceEvidenceKind;
  refId: string;
  label: string;
  snippet: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(input.proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  const owns = await ownsComplianceItem(input.itemId, organizationId);
  if (!owns.ok || owns.proposalId !== input.proposalId) {
    return { ok: false, error: "Compliance item does not belong to this proposal." };
  }

  // Validate the refId against the kind so we don't store dangling
  // pointers. For section_paragraph, confirm the section belongs to
  // this proposal. For knowledge_entry, confirm the entry belongs to
  // this org. For past_performance, the refId is the array entry's
  // stable id — no DB check possible, accept as-is.
  if (input.kind === "section_paragraph") {
    if (!(await sectionBelongsToProposal(input.refId, input.proposalId))) {
      return {
        ok: false,
        error: "Section does not belong to this proposal.",
      };
    }
  } else if (input.kind === "knowledge_entry") {
    const [k] = await db
      .select({ id: knowledgeEntries.id })
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.id, input.refId),
          eq(knowledgeEntries.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!k) {
      return {
        ok: false,
        error: "Knowledge entry not found in this organization.",
      };
    }
  }

  try {
    const [row] = await db
      .insert(complianceItemEvidence)
      .values({
        organizationId,
        complianceItemId: input.itemId,
        kind: input.kind,
        refId: input.refId,
        label: input.label.slice(0, 256),
        snippet: input.snippet.slice(0, 2000),
        createdByUserId: actor.id,
      })
      .returning({ id: complianceItemEvidence.id });
    if (!row) return { ok: false, error: "Could not attach evidence." };

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.compliance.evidence.attach",
      resourceType: "compliance_item_evidence",
      resourceId: row.id,
      metadata: {
        proposalId: input.proposalId,
        itemId: input.itemId,
        kind: input.kind,
      },
    });
    revalidatePath(`/proposals/${input.proposalId}/compliance`);
    return { ok: true, id: row.id };
  } catch (err) {
    log.error("[attachComplianceEvidenceAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Attach failed.",
    };
  }
}

export async function detachComplianceEvidenceAction(
  evidenceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Cross-tenant-safe delete: scope by both id AND organizationId so a
  // hand-typed UUID can't reach into another org's evidence rows.
  const result = await db
    .delete(complianceItemEvidence)
    .where(
      and(
        eq(complianceItemEvidence.id, evidenceId),
        eq(complianceItemEvidence.organizationId, organizationId),
      ),
    )
    .returning({
      id: complianceItemEvidence.id,
      itemId: complianceItemEvidence.complianceItemId,
    });

  if (result.length === 0) {
    return { ok: false, error: "Evidence not found." };
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.compliance.evidence.detach",
    resourceType: "compliance_item_evidence",
    resourceId: evidenceId,
    metadata: { itemId: result[0].itemId },
  });

  // Best-effort lookup of the proposal id to revalidate the page.
  const [prow] = await db
    .select({ proposalId: complianceItems.proposalId })
    .from(complianceItems)
    .where(eq(complianceItems.id, result[0].itemId))
    .limit(1);
  if (prow) revalidatePath(`/proposals/${prow.proposalId}/compliance`);

  return { ok: true };
}

export async function listProposalSectionsLite(proposalId: string) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return [];
  }
  return db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));
}
