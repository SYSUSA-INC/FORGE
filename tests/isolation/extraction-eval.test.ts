/**
 * BL-AIX Phase 1e-3 — the extraction accuracy run against Postgres, with
 * the model mocked. Asserts: a run covers every approved gold document,
 * reads it through the requirement sweep and the Section L/M passes (the
 * review since BL-STAB-9 builds on the parse, so it is not run), scores it against
 * the approved annotations only, resumes across budgeted calls, records
 * the prompt versions, and refuses stub mode. BL-AIX Phase 1i-2 — a
 * candidate model is stored on the run and pinned on every call it makes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { extractionEvalRuns, extractionGoldDocs, extractionGoldItems } from "@/db/schema";
import { __setCompleteImplForTest } from "@/lib/ai";
import { PROMPT_VERSIONS } from "@/lib/ai-prompt-versions";
import { startExtractionEval, stepExtractionEval } from "@/lib/extraction-eval";
import type { DocScore } from "@/lib/extraction-eval-logic";
import { createGoldDocFromText, setGoldDocApproved } from "@/lib/gold-set";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const RFP = [
  "SECTION C - DESCRIPTION/SPECIFICATIONS/STATEMENT OF WORK\n\n",
  ...Array.from({ length: 60 }, (_, i) => `C.${i} The contractor shall perform task number ${i} in full.\n\n`),
  "SECTION L - INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS\n\nL.1 Volume I shall not exceed 25 pages.\n\n",
  "SECTION M - EVALUATION FACTORS FOR AWARD\n\nM.1 Technical Approach is the most important factor, followed by Price.\n\n",
].join("");

const sectionL = {
  volumes: [{ name: "Volume I", pageLimit: 25, pageLimitText: "shall not exceed 25 pages", contents: "", quote: "Volume I shall not exceed 25 pages." }],
  formatRules: [],
  submission: [],
};
const sectionM = {
  basis: "tradeoff",
  basisQuote: "",
  relativeImportance: "",
  factors: [
    { name: "Technical Approach", importance: "most important", quote: "Technical Approach is the most important factor", subfactors: [] },
    { name: "Price", importance: "", quote: "", subfactors: [] },
  ],
};

describe("BL-AIX Phase 1e-3 — extraction accuracy run (runtime)", () => {
  let fx: TwoTenantFixture;
  const docs: string[] = [];
  let stubbed = false;
  let seen: { tool: string | undefined; model: string | undefined }[] = [];

  beforeEach(async () => {
    fx = await createTwoTenants("extraction-eval");
    stubbed = false;
    await db.delete(extractionEvalRuns);
    await db.update(extractionGoldDocs).set({ status: "in_review" }).where(eq(extractionGoldDocs.status, "approved"));
    for (const title of ["RFP one", "RFP two"]) {
      const res = await createGoldDocFromText({ title, text: RFP, userId: fx.orgA.userId });
      if (!res.ok) throw new Error(res.error);
      docs.push(res.id);
      await db.insert(extractionGoldItems).values([
        { docId: res.id, kind: "requirement", text: "The contractor shall perform task number 1 in full.", status: "approved" },
        { docId: res.id, kind: "requirement", text: "The contractor shall deliver a monthly status report.", status: "approved" },
        { docId: res.id, kind: "requirement", text: "Rejected annotation that must not count.", status: "rejected" },
        { docId: res.id, kind: "page_limit", text: "Volume I shall not exceed 25 pages.", value: "25 pages", status: "approved" },
        { docId: res.id, kind: "eval_factor", text: "Technical Approach", position: 1, status: "approved" },
        { docId: res.id, kind: "eval_factor", text: "Past Performance", position: 2, status: "approved" },
      ]);
      await setGoldDocApproved({ docId: res.id, approved: true, userId: fx.orgA.userId });
    }
    seen = [];
    __setCompleteImplForTest(async (opts) => {
      seen.push({ tool: opts.tool?.name, model: opts.model });
      return {
        text: "",
        provider: "stub" as const,
        model: "test-mock",
        inputTokens: 5,
        outputTokens: 5,
        stubbed,
        structured:
          opts.tool?.name === "record_section_l"
            ? sectionL
            : opts.tool?.name === "record_section_m"
              ? sectionM
              : { requirements: [{ kind: "shall", text: "The contractor shall perform task number 1 in full.", ref: "C.1" }] },
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await db.delete(extractionEvalRuns);
    if (docs.length) await db.delete(extractionGoldDocs).where(inArray(extractionGoldDocs.id, docs.splice(0)));
    await fx.cleanup();
  });

  it("scores every approved document and summarises the run", async () => {
    const started = await startExtractionEval(fx.orgA.userId);
    if (!started.ok) throw new Error(started.error);
    const res = await stepExtractionEval({ runId: started.runId, organizationId: fx.orgA.organizationId, budgetMs: 600_000 });
    expect(res).toMatchObject({ ok: true, done: true, docsDone: 2, docsTotal: 2 });

    const [run] = await db.select().from(extractionEvalRuns).where(eq(extractionEvalRuns.id, started.runId));
    expect(run!.status).toBe("done");
    expect(run!.promptVersions).toEqual({
      solicitation_extract: PROMPT_VERSIONS.solicitation_extract,
      solicitation_structure: PROMPT_VERSIONS.solicitation_structure,
    });
    expect(run!.model).toBe("test-mock");
    const scores = run!.results as DocScore[];
    expect(scores.map((s) => s.title)).toEqual(["RFP one", "RFP two"]);
    expect(scores[0]).toMatchObject({ goldRequirements: 2, extractedRequirements: 1, requirementRecall: 0.5, requirementPrecision: 1, pageLimitCapture: 1, factorRecall: 0.5 });
    expect(scores[0]!.missed.map((m) => m.text)).toEqual(["The contractor shall deliver a monthly status report.", "Past Performance"]);
    expect(run!.summary).toMatchObject({ docs: 2, requirementRecall: 0.5, requirementPrecision: 1, pageLimitCapture: 1, factorRecall: 0.5 });
    // BL-AIX Phase 2a — the one extracted clause is in the document word for word.
    expect(scores[0]!.verbatim).toBe(1);
    expect(run!.summary).toMatchObject({ verbatim: 1 });
  });

  it("resumes across budgeted calls and returns the running run instead of starting another", async () => {
    const started = await startExtractionEval(fx.orgA.userId);
    if (!started.ok) throw new Error(started.error);
    let t = 0;
    const first = await stepExtractionEval({ runId: started.runId, organizationId: fx.orgA.organizationId, budgetMs: 10, now: () => (t += 100) });
    expect(first).toMatchObject({ ok: true, done: false, docsDone: 0 });
    expect(await startExtractionEval(fx.orgA.userId)).toEqual({ ok: true, runId: started.runId, resumed: true });
    const rest = await stepExtractionEval({ runId: started.runId, organizationId: fx.orgA.organizationId, budgetMs: 600_000 });
    expect(rest).toMatchObject({ ok: true, done: true, docsDone: 2 });
  });

  it("pins a candidate model on the sweep and the Section L/M passes, and keeps it on the run", async () => {
    const started = await startExtractionEval(fx.orgA.userId, "claude-sonnet-5-5");
    if (!started.ok) throw new Error(started.error);
    const res = await stepExtractionEval({ runId: started.runId, organizationId: fx.orgA.organizationId, budgetMs: 600_000 });
    expect(res).toMatchObject({ ok: true, done: true, docsDone: 2 });
    const [run] = await db.select().from(extractionEvalRuns).where(eq(extractionEvalRuns.id, started.runId));
    expect(run!.requestedModel).toBe("claude-sonnet-5-5");
    expect(new Set(seen.map((c) => c.tool))).toEqual(new Set(["record_requirements", "record_section_l", "record_section_m"]));
    expect(seen.every((c) => c.model === "claude-sonnet-5-5")).toBe(true);
  });

  it("follows routing when no candidate is named", async () => {
    const started = await startExtractionEval(fx.orgA.userId);
    if (!started.ok) throw new Error(started.error);
    await stepExtractionEval({ runId: started.runId, organizationId: fx.orgA.organizationId, budgetMs: 600_000 });
    const [run] = await db.select().from(extractionEvalRuns).where(eq(extractionEvalRuns.id, started.runId));
    expect(run!.requestedModel).toBe("");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((c) => c.model === "claude-sonnet-5-5")).toBe(false);
  });

  it("fails the run in stub mode", async () => {
    stubbed = true;
    const started = await startExtractionEval(fx.orgA.userId);
    if (!started.ok) throw new Error(started.error);
    const res = await stepExtractionEval({ runId: started.runId, organizationId: fx.orgA.organizationId });
    expect(res).toEqual({ ok: false, error: "AI is in stub mode, so nothing can be measured. Configure a provider first." });
    const [run] = await db.select().from(extractionEvalRuns).where(eq(extractionEvalRuns.id, started.runId));
    expect(run!.status).toBe("failed");
  });
});
