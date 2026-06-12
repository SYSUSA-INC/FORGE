"use server";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  complianceItems,
  proposalSections,
  proposals,
  type ComplianceAIAssessment,
  type ComplianceCategory,
  type ComplianceStatus,
  type TipTapDoc,
} from "@/db/schema";
import { complete } from "@/lib/ai";
import {
  buildCompliancePreflightPrompt,
  compliancePreflightResponseSchema,
  parseAiJson,
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
    if (input.ownerUserId !== undefined)
      update.ownerUserId = input.ownerUserId;

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
      const res = await complete({
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
