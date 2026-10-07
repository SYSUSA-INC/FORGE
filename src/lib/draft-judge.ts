/**
 * BL-AIX Phase 1h-2 — run the draft judge on one section draft, for one
 * organization. The judge reads what an evaluator would have: the
 * section's brief, the requirements mapped to it and Section M. It never
 * reads a winning text. Server-only lib; callers own auth and quota.
 */
import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { complianceItems, proposalSections, proposals } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { buildDraftJudgePrompt, draftJudgeSchema } from "@/lib/ai-prompts";
import { cleanScores, type JudgeScores } from "@/lib/draft-judge-logic";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";

export type JudgeResult = { scores: JudgeScores; rationale: string; model: string };

/** Score `draft` for the section; null when the judge returns nothing usable or runs in stub mode. */
export async function judgeSectionDraft(input: { organizationId: string; sectionId: string; draft: string }): Promise<JudgeResult | null> {
  const { organizationId } = input;
  const [row] = await db
    .select({
      title: proposalSections.title,
      kind: proposalSections.kind,
      instructions: proposalSections.instructions,
      proposalId: proposals.id,
      opportunityId: proposals.opportunityId,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;

  const [mapped, solicitation] = await Promise.all([
    db
      .select({ text: complianceItems.requirementText })
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.proposalId, row.proposalId),
          eq(complianceItems.proposalSectionId, input.sectionId),
          ne(complianceItems.status, "not_applicable"),
        ),
      )
      .orderBy(asc(complianceItems.ordering))
      .limit(20),
    loadOpportunityRequirements({ organizationId, opportunityId: row.opportunityId }).catch(() => null),
  ]);

  const prompt = buildDraftJudgePrompt({
    sectionTitle: row.title,
    sectionKind: row.kind,
    instructions: row.instructions,
    requirements: mapped.map((m) => m.text),
    sectionM: solicitation?.sectionMSummary ?? "",
    draft: input.draft,
  });
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "draft_judge",
    variant: "golden_eval",
    schema: draftJudgeSchema,
    toolName: "record_draft_scores",
    toolDescription: "Record the section's scores and the rationale.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 800,
    temperature: 0,
    cacheSystem: true,
  });
  if (res.stubbed || !res.data) return null;
  const scores = cleanScores(res.data);
  return scores ? { scores, rationale: res.data.rationale.trim().slice(0, 1_200), model: res.model } : null;
}
