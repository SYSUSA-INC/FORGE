/**
 * BL-AIP-5 — compliance auto-map as a library.
 *
 * The AI mapping of matrix rows to proposal sections lived inside the
 * `runComplianceAutoMapAction` server action, so nothing could run it
 * without a click. Proposal creation now seeds the matrix from the
 * solicitation and needs to map the rows in the background; the action
 * keeps its gates and delegates here.
 *
 * Server-only. `compliance_item` and `proposal_section` hang off the
 * proposal, so every entry point verifies the proposal belongs to the
 * caller's organization before touching either.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceItems, proposalSections, proposals } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import {
  buildComplianceAutoMapPrompt,
  complianceAutoMapResponseSchema,
  type ComplianceAutoMapVerdict,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

export type AutoMapConfidence = "high" | "medium" | "low";

export type AutoMapSuggestion = {
  itemId: string;
  itemNumber: string;
  itemText: string;
  currentSectionId: string | null;
  suggestedSectionId: string;
  suggestedSectionTitle: string;
  confidence: AutoMapConfidence;
  rationale: string;
};

export type AutoMapComputation =
  | {
      ok: true;
      suggestions: AutoMapSuggestion[];
      unchanged: number;
      stubbed: boolean;
      model: string;
      totalItems: number;
    }
  | { ok: false; error: string; noAiCall: boolean };

const CONFIDENCE: Set<AutoMapConfidence> = new Set(["high", "medium", "low"]);
const CONFIDENCE_RANK: Record<AutoMapConfidence, number> = { high: 3, medium: 2, low: 1 };

/** Cap items per call to keep prompts in bounds. */
const ITEMS_PER_BATCH = 80;

async function ownsProposal(proposalId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return !!row;
}

/**
 * Ask the model for a section per matrix row. Writes nothing; returns
 * suggestions for the caller to apply. `noAiCall` on failure tells the
 * caller whether a quota slot can be refunded.
 */
export async function computeComplianceAutoMap(input: {
  organizationId: string;
  proposalId: string;
  /** Only consider rows with no section yet (the seeding path). */
  unmappedOnly?: boolean;
}): Promise<AutoMapComputation> {
  const { organizationId, proposalId } = input;
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found.", noAiCall: true };
  }

  const allItems = await db
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
  const items = input.unmappedOnly ? allItems.filter((it) => !it.proposalSectionId) : allItems;

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
    return {
      ok: false,
      error: input.unmappedOnly
        ? "Every compliance item already has a section."
        : "No compliance items to map. Import or add items first.",
      noAiCall: true,
    };
  }
  if (sections.length === 0) {
    return { ok: false, error: "Proposal has no sections to map to. Add sections first.", noAiCall: true };
  }

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
      sections: sections.map((s) => ({ sectionId: s.id, title: s.title, kind: s.kind })),
    });
    try {
      const res = await completeStructuredForTenant({
        organizationId,
        feature: "compliance_automap",
        schema: complianceAutoMapResponseSchema,
        toolName: "record_requirement_mappings",
        toolDescription:
          "Record the proposal section each compliance item should be answered in, with confidence.",
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: 3000,
        temperature: 0,
        cacheSystem: true,
      });
      stubbed = stubbed || res.stubbed;
      model = `${res.provider}:${res.model}`;
      if (!res.data) {
        log.warn("[computeComplianceAutoMap]", "structured parse failed", {
          parseError: res.parseError,
          viaTool: res.viaTool,
          rawSnippet: res.text.slice(0, 240),
        });
        continue;
      }
      aggregated.push(...res.data.mappings);
    } catch (err) {
      log.warn("[computeComplianceAutoMap]", "AI call failed", { error: err });
      continue;
    }
  }

  if (aggregated.length === 0) {
    return {
      ok: false,
      error: "AI returned no usable mappings. Re-run, or check the AI provider configuration.",
      noAiCall: false,
    };
  }

  const validSectionIds = new Set(sections.map((s) => s.id));
  const itemIndex = new Map(items.map((it) => [it.id, it]));
  const suggestions: AutoMapSuggestion[] = [];
  let unchanged = 0;
  for (const v of aggregated) {
    if (!CONFIDENCE.has(v.confidence)) continue;
    const item = itemIndex.get(v.itemId);
    if (!item) continue;
    if (!v.sectionId || !validSectionIds.has(v.sectionId)) continue;
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

  return { ok: true, suggestions, unchanged, stubbed, model, totalItems: items.length };
}

/**
 * Write a set of item → section mappings. Refuses the whole batch when
 * any section is not this proposal's. Sequential per Neon rule.
 */
export async function applyComplianceMappings(input: {
  organizationId: string;
  proposalId: string;
  mappings: { itemId: string; sectionId: string }[];
}): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const { organizationId, proposalId } = input;
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (input.mappings.length === 0) return { ok: true, applied: 0 };

  const sectionRows = await db
    .select({ id: proposalSections.id })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId));
  const validIds = new Set(sectionRows.map((r) => r.id));
  for (const m of input.mappings) {
    if (!validIds.has(m.sectionId)) {
      return { ok: false, error: "One or more sections do not belong to this proposal." };
    }
  }

  let applied = 0;
  const now = new Date();
  for (const m of input.mappings) {
    const r = await db
      .update(complianceItems)
      .set({ proposalSectionId: m.sectionId, updatedAt: now })
      .where(and(eq(complianceItems.id, m.itemId), eq(complianceItems.proposalId, proposalId)))
      .returning({ id: complianceItems.id });
    if (r.length > 0) applied += 1;
  }
  return { ok: true, applied };
}

/**
 * Seeding path: map the unmapped rows and apply every suggestion at or
 * above `minConfidence` without a human in the loop. Audited as an
 * automatic apply so the trail shows which mappings nobody reviewed.
 */
export async function autoMapAndApply(input: {
  organizationId: string;
  proposalId: string;
  actor: { id: string; email?: string | null };
  minConfidence?: AutoMapConfidence;
}): Promise<{ ok: true; applied: number; suggested: number; stubbed: boolean } | { ok: false; error: string }> {
  const min = input.minConfidence ?? "high";
  const computed = await computeComplianceAutoMap({
    organizationId: input.organizationId,
    proposalId: input.proposalId,
    unmappedOnly: true,
  });
  if (!computed.ok) return { ok: false, error: computed.error };
  if (computed.stubbed) {
    return { ok: true, applied: 0, suggested: computed.suggestions.length, stubbed: true };
  }
  const chosen = computed.suggestions.filter(
    (s) => CONFIDENCE_RANK[s.confidence] >= CONFIDENCE_RANK[min],
  );
  const applied = await applyComplianceMappings({
    organizationId: input.organizationId,
    proposalId: input.proposalId,
    mappings: chosen.map((s) => ({ itemId: s.itemId, sectionId: s.suggestedSectionId })),
  });
  if (!applied.ok) return applied;

  await recordAudit({
    organizationId: input.organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "proposal.compliance.automap.auto_apply",
    resourceType: "proposal",
    resourceId: input.proposalId,
    metadata: {
      proposalId: input.proposalId,
      totalItems: computed.totalItems,
      suggested: computed.suggestions.length,
      applied: applied.applied,
      minConfidence: min,
      model: computed.model,
    },
  });
  return { ok: true, applied: applied.applied, suggested: computed.suggestions.length, stubbed: false };
}
