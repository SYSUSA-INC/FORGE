/**
 * BL-AIX Phase 1h-1 — the Brain retrieval eval against Postgres, with
 * stub embeddings (so the full-text half ranks).
 *
 * Asserts: cases come from the organization's own won, harvested
 * proposals; a section whose winning text is in its Brain is found; a
 * section whose winning text exists only in ANOTHER organization's Brain
 * is not (retrieval never crosses tenants); the run is stored and
 * audited for the organization alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  complianceItems,
  knowledgeArtifactChunks,
  knowledgeArtifacts,
  proposalOutcomes,
  proposalSections,
} from "@/db/schema";
import { BRAIN_RETRIEVAL_VERSION } from "@/lib/brain-rank";
import { listRetrievalEvalRuns, runRetrievalEval } from "@/lib/retrieval-eval";
import type { RetrievalCaseResult } from "@/lib/retrieval-eval-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const WORDS = (seed: string) => Array.from({ length: 90 }, (_, i) => `${seed}${i % 9}`).join(" ");
const IN_A =
  `Our zerodowntime cutover plan moves every legacy payroll workload through quartzline staging with rehearsed rollback windows. ${WORDS("alpha")}`;
const ONLY_IN_B =
  `Our helpdesk staffing model keeps marigold tier specialists on call around the clock with a fifteen minute pickup promise. ${WORDS("bravo")}`;

describe("BL-AIX Phase 1h-1 — retrieval eval (runtime)", () => {
  let fx: TwoTenantFixture;
  let savedKey: string | undefined;

  beforeEach(async () => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY; // stub embeddings: the full-text half ranks
    fx = await createTwoTenants("retrieval-eval");
    const a = fx.orgA;

    const [s1, s2] = await db
      .insert(proposalSections)
      .values([
        { proposalId: a.proposalId, kind: "technical", title: "Cutover approach", content: IN_A, wordCount: 110, ordering: 1 },
        { proposalId: a.proposalId, kind: "management", title: "Help desk staffing", content: ONLY_IN_B, wordCount: 110, ordering: 2 },
      ])
      .returning({ id: proposalSections.id });
    await db.insert(proposalOutcomes).values({ proposalId: a.proposalId, organizationId: a.organizationId, outcomeType: "won" });
    await db.insert(complianceItems).values([
      { proposalId: a.proposalId, proposalSectionId: s1!.id, requirementText: "Describe the zerodowntime cutover of legacy payroll workloads and quartzline staging." },
      { proposalId: a.proposalId, proposalSectionId: s2!.id, requirementText: "Describe marigold tier specialists and the helpdesk staffing model." },
    ]);

    // A's harvest carries only the first section's winning text.
    const [artA] = await db
      .insert(knowledgeArtifacts)
      .values({ organizationId: a.organizationId, kind: "proposal", source: "mined_from_proposal", title: "Submitted: A", rawText: IN_A, status: "indexed", outcomeLabel: "won", metadata: { proposalId: a.proposalId } })
      .returning({ id: knowledgeArtifacts.id });
    await db.insert(knowledgeArtifactChunks).values({ organizationId: a.organizationId, artifactId: artA!.id, chunkIndex: 0, content: IN_A });

    // The second section's winning text exists only in B's Brain.
    const [artB] = await db
      .insert(knowledgeArtifacts)
      .values({ organizationId: fx.orgB.organizationId, kind: "proposal", source: "uploaded", title: "B's proposal", rawText: ONLY_IN_B, status: "indexed", outcomeLabel: "won" })
      .returning({ id: knowledgeArtifacts.id });
    await db.insert(knowledgeArtifactChunks).values({ organizationId: fx.orgB.organizationId, artifactId: artB!.id, chunkIndex: 0, content: ONLY_IN_B });
  });

  afterEach(async () => {
    await fx.cleanup();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it("finds the organization's own winning text and never another organization's", async () => {
    const res = await runRetrievalEval({ organizationId: fx.orgA.organizationId, actor: { userId: fx.orgA.userId } });
    if (!res.ok) throw new Error(res.error);
    const run = res.run;
    expect(run).toMatchObject({ organizationId: fx.orgA.organizationId, caseCount: 2, retrievalVersion: BRAIN_RETRIEVAL_VERSION, stubbed: true });

    const results = run.results as unknown as RetrievalCaseResult[];
    const bySection = new Map(results.map((r) => [r.sectionTitle, r]));
    const own = bySection.get("Cutover approach")!;
    const foreign = bySection.get("Help desk staffing")!;
    expect(own.error).toBeUndefined();
    expect(own.ranks.requirements).not.toBeNull();
    expect(own.ranks.requirements!).toBeLessThanOrEqual(8);
    expect("drafter" in own.ranks).toBe(true);
    // Only B's Brain holds this text: A's search must not find it.
    expect(foreign.ranks.requirements).toBeNull();
    expect(foreign.ranks.drafter ?? null).toBeNull();

    expect(await listRetrievalEvalRuns({ organizationId: fx.orgB.organizationId })).toHaveLength(0);
    expect((await listRetrievalEvalRuns({ organizationId: fx.orgA.organizationId })).map((r) => r.id)).toEqual([run.id]);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.some((a) => a.action === "ai.retrieval_eval.run")).toBe(true);
  });

  it("explains when there is nothing to evaluate yet", async () => {
    const res = await runRetrievalEval({ organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId } });
    expect(res).toMatchObject({ ok: false });
    expect(await listRetrievalEvalRuns({ organizationId: fx.orgB.organizationId })).toHaveLength(0);
  });
});
