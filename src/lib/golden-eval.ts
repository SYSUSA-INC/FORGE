/**
 * BL-AIP-5b — the golden eval set.
 *
 * The drafter's prompt has changed many times and nothing ever said
 * whether a change helped. The golden set is the tenant's own won
 * proposals: for each case the drafter re-drafts a section from the
 * solicitation context alone (the saved body is withheld) and the
 * draft is scored against the text that actually won
 * (`src/lib/golden-score.ts`, deterministic). One run = one row keyed
 * by the drafter's prompt version and the model, so the next prompt
 * change is compared to the last one on the same cases.
 *
 * Known limit: the Brain may already hold the harvested winning text,
 * so pattern retrieval can show the drafter fragments of the answer.
 * Every prompt version faces the same corpus, which keeps runs
 * comparable; treat absolute scores as an upper bound.
 *
 * Every read and write carries organizationId. Server-only; callers
 * own auth, feature gating and quota (one draft call per case).
 */
import "server-only";

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  aiEvalRuns,
  opportunities,
  proposalOutcomes,
  proposalSections,
  proposals,
  type AiEvalCaseResult,
  type AiEvalRun,
} from "@/db/schema";
import { completeForTenant } from "@/lib/ai";
import { SECTION_DRAFT_PROMPT_VERSION } from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { meanScore, scoreDraftAgainstGolden } from "@/lib/golden-score";
import { log } from "@/lib/log";
import { prepareSectionDraft } from "@/lib/section-draft";

export const GOLDEN_MIN_WORDS = 150;
export const GOLDEN_MAX_CASES = 5;

export type GoldenCase = {
  proposalId: string;
  proposalTitle: string;
  sectionId: string;
  sectionTitle: string;
  sectionKind: string;
  agency: string;
  wordCount: number;
};

/** Sections of won proposals with enough text to be a benchmark. */
export async function listGoldenCases(input: {
  organizationId: string;
  limit?: number;
}): Promise<GoldenCase[]> {
  const { organizationId } = input;
  const rows = await db
    .select({
      proposalId: proposals.id,
      proposalTitle: proposals.title,
      sectionId: proposalSections.id,
      sectionTitle: proposalSections.title,
      sectionKind: proposalSections.kind,
      agency: opportunities.agency,
      wordCount: proposalSections.wordCount,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(
      proposalOutcomes,
      and(
        eq(proposalOutcomes.proposalId, proposals.id),
        eq(proposalOutcomes.organizationId, organizationId),
        eq(proposalOutcomes.outcomeType, "won"),
      ),
    )
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(eq(proposals.organizationId, organizationId), gte(proposalSections.wordCount, GOLDEN_MIN_WORDS)),
    )
    .orderBy(desc(proposals.updatedAt), desc(proposalSections.wordCount))
    .limit(input.limit ?? 50);
  return rows;
}

export type GoldenEvalResult =
  | { ok: true; run: AiEvalRun }
  | { ok: false; error: string };

/** Re-draft up to `maxCases` golden sections and store the scored run. */
export async function runGoldenEval(input: {
  organizationId: string;
  actor: { userId: string | null; email?: string | null };
  maxCases?: number;
}): Promise<GoldenEvalResult> {
  const { organizationId } = input;
  const maxCases = Math.max(1, Math.min(GOLDEN_MAX_CASES, input.maxCases ?? 3));
  const cases = await listGoldenCases({ organizationId, limit: maxCases });
  if (cases.length === 0) {
    return { ok: false, error: "No won proposals with drafted sections yet — the golden set is empty." };
  }

  const results: AiEvalCaseResult[] = [];
  let stubbed = false;
  let model = "";

  for (const c of cases) {
    const base = {
      proposalId: c.proposalId,
      sectionId: c.sectionId,
      sectionTitle: c.sectionTitle,
      sectionKind: c.sectionKind,
      agency: c.agency,
      goldenWords: c.wordCount,
    };
    try {
      const [row] = await db
        .select({ content: proposalSections.content, winThemes: proposals.winThemes })
        .from(proposalSections)
        .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
        .where(
          and(eq(proposalSections.id, c.sectionId), eq(proposals.organizationId, organizationId)),
        )
        .limit(1);
      if (!row) throw new Error("Section not found.");

      // The saved body is withheld: the drafter sees only what it would
      // see on a blank section (empty string, not undefined).
      const prepared = await prepareSectionDraft({
        organizationId,
        sectionId: c.sectionId,
        mode: "draft",
        cite: false,
        currentBodyPlain: "",
      });
      if (!prepared.ok) throw new Error(prepared.error);

      const ai = await completeForTenant({
        organizationId,
        feature: "section_draft",
        variant: "golden_eval",
        promptVersion: SECTION_DRAFT_PROMPT_VERSION,
        system: prepared.prompt.system,
        messages: prepared.prompt.messages,
        maxTokens: prepared.maxTokens,
        temperature: prepared.temperature,
        cacheSystem: true,
      });
      stubbed = stubbed || ai.stubbed;
      model = model || ai.model;

      const score = scoreDraftAgainstGolden({
        draft: ai.text ?? "",
        golden: row.content,
        themes: row.winThemes ?? [],
      });
      results.push({
        ...base,
        goldenWords: score.goldenWords,
        draftWords: score.draftWords,
        score: score.score,
        termCoverage: score.termCoverage,
        lengthFit: score.lengthFit,
        specificity: score.specificity,
        placeholderRate: score.placeholderRate,
        themeCoverage: score.themeCoverage,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("[runGoldenEval]", "case failed", { sectionId: c.sectionId, error: message });
      results.push({
        ...base,
        draftWords: 0,
        score: 0,
        termCoverage: 0,
        lengthFit: 0,
        specificity: 0,
        placeholderRate: 0,
        themeCoverage: null,
        error: message.slice(0, 300),
      });
    }
  }

  const scored = results.filter((r) => !r.error);
  const [run] = await db
    .insert(aiEvalRuns)
    .values({
      organizationId,
      feature: "section_draft",
      promptVersion: SECTION_DRAFT_PROMPT_VERSION,
      model,
      caseCount: scored.length,
      meanScore: meanScore(scored),
      results,
      stubbed,
      requestedByUserId: input.actor.userId,
    })
    .returning();
  if (!run) return { ok: false, error: "Could not record the eval run." };

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "ai.eval.run",
    resourceType: "ai_eval_run",
    resourceId: run.id,
    metadata: {
      promptVersion: run.promptVersion,
      model,
      caseCount: run.caseCount,
      meanScore: run.meanScore,
      stubbed,
      failed: results.length - scored.length,
    },
  });
  return { ok: true, run };
}

export async function listEvalRuns(input: {
  organizationId: string;
  limit?: number;
}): Promise<AiEvalRun[]> {
  const { organizationId } = input;
  return db
    .select()
    .from(aiEvalRuns)
    .where(eq(aiEvalRuns.organizationId, organizationId))
    .orderBy(desc(aiEvalRuns.createdAt))
    .limit(input.limit ?? 12);
}
