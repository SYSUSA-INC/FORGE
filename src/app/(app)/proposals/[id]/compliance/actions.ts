"use server";

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
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
  type CompliancePreflightItem,
  type CompliancePreflightVerdict,
} from "@/lib/ai-prompts";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { projectToPlain } from "@/lib/tiptap-doc";

async function ownsProposal(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)))
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

    revalidatePath(`/proposals/${proposalId}/compliance`);
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[createComplianceItemAction]", err);
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
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
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

    revalidatePath(`/proposals/${proposalId}/compliance`);
    return { ok: true };
  } catch (err) {
    console.error("[updateComplianceItemAction]", err);
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
  await requireAuth();
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
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
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
      console.warn("[runCompliancePreflightAction] AI call failed", err);
      continue;
    }

    let parsed: { verdicts?: CompliancePreflightVerdict[] };
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (err) {
      console.warn("[runCompliancePreflightAction] JSON parse failed", err, raw.slice(0, 240));
      continue;
    }
    if (!parsed.verdicts || !Array.isArray(parsed.verdicts)) continue;

    // Apply each verdict back to its item, sequentially per Neon rule.
    for (const v of parsed.verdicts) {
      if (
        !v ||
        typeof v.itemId !== "string" ||
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
        gap: typeof v.gap === "string" ? v.gap.slice(0, 600) : "",
        suggestion:
          typeof v.suggestion === "string" ? v.suggestion.slice(0, 600) : "",
        model: provider,
      };

      await db
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
          ),
        );
      assessed += 1;
    }
  }

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
  await requireAuth();
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
  await requireAuth();
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
  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true };
}

/**
 * Pull a JSON object out of a model response. Models occasionally
 * wrap output in markdown fences or add a leading sentence; this
 * helper trims to the outermost {...} block.
 */
function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
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
