/**
 * BL-AIX Phase 1h-1 — the Brain retrieval eval for one organization.
 *
 * Cases are sections of the organization's own won proposals that have
 * been harvested into its corpus. Each is searched the way FORGE would
 * search when drafting that section anew (see retrieval-eval-logic.ts
 * for the two query modes), and scored by whether its winning text comes
 * back and how high. Every read is scoped to the organization; the run
 * is stored for it alone. Server-only lib, callers own auth.
 */
import "server-only";

import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  knowledgeArtifacts,
  opportunities,
  proposalOutcomes,
  proposalSections,
  proposals,
  retrievalEvalRuns,
  type RetrievalEvalRun,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { BRAIN_RETRIEVAL_VERSION } from "@/lib/brain-rank";
import { searchBrain } from "@/lib/brain-retrieval";
import { draftSourcesQuery, MAX_DRAFT_SOURCES } from "@/lib/citations";
import { log } from "@/lib/log";
import {
  firstRelevantRank,
  requirementsQuery,
  RETRIEVAL_MAX_CASES,
  RETRIEVAL_MAX_REQUIREMENTS,
  RETRIEVAL_MIN_WORDS,
  summarizeRetrieval,
  type RetrievalCaseResult,
  type RetrievalMode,
} from "@/lib/retrieval-eval-logic";

type RetrievalCase = {
  proposalId: string;
  proposalTitle: string;
  sectionId: string;
  sectionTitle: string;
  sectionKind: string;
  content: string;
  agency: string;
  naicsCode: string;
  opportunityDescription: string;
};

/** Sections of won proposals already in the corpus, with enough winning text, newest first, spread across proposals. */
async function listRetrievalCases(organizationId: string, limit: number): Promise<RetrievalCase[]> {
  const harvested = await db
    .select({ proposalId: sql<string>`${knowledgeArtifacts.metadata} ->> 'proposalId'` })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.organizationId, organizationId),
        eq(knowledgeArtifacts.source, "mined_from_proposal"),
        isNull(knowledgeArtifacts.archivedAt),
      ),
    );
  const ids = [...new Set(harvested.map((h) => h.proposalId).filter(Boolean))];
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      proposalId: proposals.id,
      proposalTitle: proposals.title,
      sectionId: proposalSections.id,
      sectionTitle: proposalSections.title,
      sectionKind: proposalSections.kind,
      content: proposalSections.content,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      opportunityDescription: opportunities.description,
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
      and(
        eq(proposals.organizationId, organizationId),
        inArray(proposals.id, ids),
        gte(proposalSections.wordCount, RETRIEVAL_MIN_WORDS),
      ),
    )
    .orderBy(desc(proposals.updatedAt), desc(proposalSections.wordCount))
    .limit(200);

  // Round-robin across proposals so one large proposal cannot fill the run.
  const byProposal = new Map<string, RetrievalCase[]>();
  for (const r of rows) {
    if (!r.content.trim()) continue;
    const list = byProposal.get(r.proposalId) ?? [];
    list.push({
      ...r,
      agency: r.agency ?? "",
      naicsCode: r.naicsCode ?? "",
      opportunityDescription: r.opportunityDescription ?? "",
    });
    byProposal.set(r.proposalId, list);
  }
  const out: RetrievalCase[] = [];
  const queues = [...byProposal.values()];
  for (let i = 0; out.length < limit && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < limit) out.push(q[i]!);
  }
  return out;
}

export type RetrievalEvalOutcome = { ok: true; run: RetrievalEvalRun } | { ok: false; error: string };

export async function runRetrievalEval(input: {
  organizationId: string;
  actor: { userId: string | null; email?: string | null };
  maxCases?: number;
}): Promise<RetrievalEvalOutcome> {
  const { organizationId } = input;
  const cases = await listRetrievalCases(organizationId, Math.max(1, Math.min(RETRIEVAL_MAX_CASES, input.maxCases ?? RETRIEVAL_MAX_CASES)));
  if (cases.length === 0) {
    return {
      ok: false,
      error: `No cases yet: the eval needs won proposals harvested into the Brain, with sections of at least ${RETRIEVAL_MIN_WORDS} words.`,
    };
  }

  const mapped = await db
    .select({ sectionId: complianceItems.proposalSectionId, text: complianceItems.requirementText })
    .from(complianceItems)
    .innerJoin(proposals, eq(proposals.id, complianceItems.proposalId))
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        inArray(complianceItems.proposalSectionId, cases.map((c) => c.sectionId)),
        ne(complianceItems.status, "not_applicable"),
      ),
    );
  const requirementsBySection = new Map<string, string[]>();
  for (const m of mapped) {
    if (!m.sectionId) continue;
    const list = requirementsBySection.get(m.sectionId) ?? [];
    if (list.length < RETRIEVAL_MAX_REQUIREMENTS) list.push(m.text);
    requirementsBySection.set(m.sectionId, list);
  }

  let provider = "";
  let stubbed = false;
  const results: RetrievalCaseResult[] = [];
  for (const c of cases) {
    const result: RetrievalCaseResult = {
      proposalId: c.proposalId,
      proposalTitle: c.proposalTitle,
      sectionId: c.sectionId,
      sectionTitle: c.sectionTitle,
      sectionKind: c.sectionKind,
      ranks: {},
      hitsReturned: {},
    };
    const queries: [RetrievalMode, string | null][] = [
      [
        "drafter",
        draftSourcesQuery({
          sectionTitle: c.sectionTitle,
          sectionKind: c.sectionKind,
          agency: c.agency,
          naicsCode: c.naicsCode,
          opportunityDescription: c.opportunityDescription,
          currentBodyPlain: "",
        }),
      ],
      ["requirements", requirementsQuery({ sectionTitle: c.sectionTitle, sectionKind: c.sectionKind, requirements: requirementsBySection.get(c.sectionId) ?? [] })],
    ];
    try {
      for (const [mode, query] of queries) {
        if (!query) continue;
        const res = await searchBrain({ organizationId, query, take: MAX_DRAFT_SOURCES });
        if (!res.ok) throw new Error(res.error);
        provider = res.provider;
        stubbed = stubbed || res.stubbed;
        result.hitsReturned[mode] = res.hits.length;
        result.ranks[mode] = firstRelevantRank(
          res.hits.map((h) => h.content),
          c.content,
        );
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      log.warn("[runRetrievalEval]", "case failed", { organizationId, sectionId: c.sectionId, error: err });
    }
    results.push(result);
  }

  const summary = summarizeRetrieval(results);
  const [run] = await db
    .insert(retrievalEvalRuns)
    .values({
      organizationId,
      retrievalVersion: BRAIN_RETRIEVAL_VERSION,
      embeddingProvider: provider,
      caseCount: results.length,
      summary,
      results,
      stubbed,
      requestedByUserId: input.actor.userId,
    })
    .returning();
  if (!run) return { ok: false, error: "The run could not be stored." };

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "ai.retrieval_eval.run",
    resourceType: "retrieval_eval_run",
    resourceId: run.id,
    metadata: { cases: results.length, retrievalVersion: BRAIN_RETRIEVAL_VERSION, stubbed, summary },
  });
  return { ok: true, run };
}

export async function listRetrievalEvalRuns(input: { organizationId: string; limit?: number }): Promise<RetrievalEvalRun[]> {
  return db
    .select()
    .from(retrievalEvalRuns)
    .where(eq(retrievalEvalRuns.organizationId, input.organizationId))
    .orderBy(desc(retrievalEvalRuns.createdAt))
    .limit(input.limit ?? 8);
}
