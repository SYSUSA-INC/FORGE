/**
 * BL-STAB-9 — the AI document review (BL-23) on a real-size RFP.
 *
 * The owner's review failed with "requirements / capabilityAreas /
 * evaluationFactors: expected array, received undefined": one 4,000-token
 * answer was asked to re-extract every requirement and was cut off. Now
 * the review builds on the parse, a cut-off answer says it was cut off
 * (and the call log records why the provider stopped), and the matrix
 * scores the requirements a window at a time. Postgres; the AI provider
 * is a mocked Anthropic API, so the real gateway runs end to end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiCallLogs, solicitationCapabilityMatrices, solicitationReviews, solicitations } from "@/db/schema";
import type { ReviewedRequirement } from "@/lib/requirement-review";
import { buildReviewBasis, reviewFreshness } from "@/lib/review-basis";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@review.test",
  name: "Capture Lead",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  requireOrgAdmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));
vi.mock("@/lib/matrix-knowledge", () => ({
  selectKnowledgeForMatrix: async () => ({
    entries: [{ id: "k1", kind: "past_performance", title: "DHS help desk", body: "Ran a 40-seat Tier 1-3 help desk for DHS for five years.", tags: ["help desk"] }],
  }),
}));

import { runCapabilityMatrixAction, runSolicitationReviewAction } from "@/app/(app)/solicitations/[id]/review-actions";

const ENV_KEYS = ["AI_PROVIDER", "AI_FALLBACK_PROVIDER", "AI_MODEL_ROUTING", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"] as const;

const REQUIREMENTS: ReviewedRequirement[] = Array.from({ length: 45 }, (_, i) => ({
  kind: i % 9 === 0 ? "should" : "shall",
  text: `The contractor shall perform help desk task ${i + 1} and report it to the COR within five business days.`,
  ref: `C.3.${i + 1}`,
  source: { quote: "exact", section: "C" },
}));
const REJECTED: ReviewedRequirement = { kind: "may", text: "Offerors may attend a site visit.", ref: "L.2", review: { status: "rejected" } };

const LM = {
  sectionL: {
    volumes: [{ name: "Volume I - Technical", pageLimit: 25, pageLimitText: "25 pages", contents: "Technical approach", quote: "Volume I shall not exceed 25 pages." }],
    formatRules: [{ rule: "12-point Times New Roman", quote: "12-point Times New Roman" }],
    submission: [],
  },
  sectionM: {
    basis: "tradeoff" as const,
    basisQuote: "best value",
    relativeImportance: "Technical approach is more important than price.",
    factors: [
      { name: "Technical approach", importance: "most important", subfactors: [], quote: "Factor 1" },
      { name: "Price", importance: "", subfactors: [], quote: "Factor 2" },
    ],
  },
};

type Call = { tool: string; ids: string[]; body: Record<string, unknown> };

describe("BL-STAB-9 — the AI document review on a real-size RFP (runtime)", () => {
  let fx: TwoTenantFixture;
  let saved: Record<string, string | undefined>;
  let calls: Call[];
  /** Ids whose matrix window comes back cut off while the window is bigger than this. */
  let cutWhenLarger: { id: string; above: number } | null;
  /** A matrix window holding this id gets a provider error. */
  let errorFor: string | null;
  let reviewCutOff: boolean;

  function respond(tool: string, ids: string[]) {
    const tool_use = (input: unknown, stop = "tool_use") => ({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "tool_use", id: "toolu_1", name: tool, input }],
      stop_reason: stop,
      usage: { input_tokens: 9_000, output_tokens: stop === "max_tokens" ? 2_000 : 400 },
    });
    if (tool === "record_solicitation_review") {
      return reviewCutOff
        ? tool_use({ summary: "OED help desk support.", periodOfPerformance: "12 months" }, "max_tokens")
        : tool_use({
            summary: "OED buys Tier 1-3 help desk support; technical approach decides the award.",
            periodOfPerformance: "One base year and four option years",
            placeOfPerformance: "Washington, DC",
            setAside: "",
            mandatoryCertifications: ["Section 508 ICT accessibility"],
            flaggedQuestions: ["Do resumes count toward the 25-page limit?"],
          });
    }
    if (tool === "record_capability_cells") {
      if (cutWhenLarger && ids.includes(cutWhenLarger.id) && ids.length > cutWhenLarger.above) {
        return tool_use({ cells: ids.slice(0, 2).map((id) => ({ requirementId: id, status: "partial" })) }, "max_tokens");
      }
      return tool_use({
        cells: ids.map((id, i) => ({ requirementId: id, capabilityRef: "knowledge:k1", status: i % 2 ? "Strong" : "gap", citation: "Ran a 40-seat help desk", narrative: "Fits." })),
      });
    }
    if (tool === "record_pwin_recommendation") {
      return tool_use({ pwinRecommendationLow: 40, pwinRecommendationHigh: 55, pwinRationale: "Mixed coverage." });
    }
    throw new Error(`unexpected tool ${tool}`);
  }

  beforeEach(async () => {
    saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    fx = await createTwoTenants("sol-review");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    calls = [];
    cutWhenLarger = null;
    errorFor = null;
    reviewCutOff = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { tool_choice?: { name?: string }; tools?: { name: string }[]; messages: { content: unknown }[] };
        const tool = body.tool_choice?.name ?? body.tools?.[0]?.name ?? "";
        const text = JSON.stringify(body.messages);
        const ids = [...new Set([...text.matchAll(/id=(req_[0-9a-f_]+)/g)].map((m) => m[1]!))];
        calls.push({ tool, ids, body });
        if (errorFor && tool === "record_capability_cells" && ids.includes(errorFor)) {
          return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad request" } }), { status: 400, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify(respond(tool, ids)), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fx.cleanup();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function parsedSolicitation(overrides: Partial<typeof solicitations.$inferInsert> = {}) {
    const [row] = await db
      .insert(solicitations)
      .values({
        organizationId: fx.orgA.organizationId,
        title: "OED help desk RFP",
        fileName: "oed.pdf",
        parseStatus: "parsed",
        rawText: "SECTION C — The contractor shall staff the help desk. ".repeat(4_000),
        sectionLSummary: "Volume I is limited to 25 pages.",
        sectionMSummary: "Best value.",
        extractedRequirements: [...REQUIREMENTS, REJECTED],
        lmStructure: LM,
        ...overrides,
      })
      .returning({ id: solicitations.id });
    return row!.id;
  }

  it("says a cut-off review was cut off (the owner's failure) and logs why the provider stopped", async () => {
    const id = await parsedSolicitation();
    reviewCutOff = true;
    const res = await runSolicitationReviewAction(id);
    expect(res).toEqual({ ok: false, error: "The AI's answer was cut off at its 2,000-token output limit before it finished." });

    const [review] = await db.select().from(solicitationReviews).where(and(eq(solicitationReviews.organizationId, fx.orgA.organizationId), eq(solicitationReviews.solicitationId, id)));
    expect(review!.status).toBe("failed");
    expect(review!.error).toMatch(/cut off/);
    const [logRow] = await db
      .select()
      .from(aiCallLogs)
      .where(and(eq(aiCallLogs.organizationId, fx.orgA.organizationId), eq(aiCallLogs.feature, "solicitation_review")))
      .orderBy(desc(aiCallLogs.createdAt))
      .limit(1);
    expect(logRow).toMatchObject({ stopReason: "max_tokens", parseOk: false, maxTokens: 2000 });
  });

  it("builds the review on the parse and asks the model for judgement only", async () => {
    const id = await parsedSolicitation();
    const res = await runSolicitationReviewAction(id);
    expect(res).toMatchObject({ ok: true, requirementCount: 45 });

    // The model was not asked to list requirements, L, M or factors.
    const reviewCall = calls.find((c) => c.tool === "record_solicitation_review")!;
    const props = Object.keys(((reviewCall.body.tools as { input_schema: { properties: object } }[])[0]!.input_schema.properties));
    expect(props.sort()).toEqual(["flaggedQuestions", "mandatoryCertifications", "periodOfPerformance", "placeOfPerformance", "setAside", "summary"]);

    const [review] = await db.select().from(solicitationReviews).where(and(eq(solicitationReviews.organizationId, fx.orgA.organizationId), eq(solicitationReviews.solicitationId, id)));
    const result = review!.result;
    expect(result.requirements).toHaveLength(45); // the rejected clause is left out
    expect(result.requirements.every((r) => /^req_[0-9a-f]{12}$/.test(r.id))).toBe(true);
    expect(result.requirements[0]).toMatchObject({ sectionRef: "C.3.1", capabilityArea: "Section C" });
    expect(result.sectionL[0]).toBe("Volume I - Technical: 25 pages — Technical approach");
    expect(result.evaluationFactors.map((f) => f.name)).toEqual(["Technical approach", "Price"]);
    expect(result.summary).toMatch(/help desk/);
    expect(result.basis).toMatchObject({ source: "parse", requirementCount: 45 });

    // The page reads it as current until the parse's list changes.
    const current = buildReviewBasis({ requirements: [...REQUIREMENTS, REJECTED], lm: LM, sectionLSummary: "", sectionMSummary: "" });
    expect(reviewFreshness(result, current.hash)).toBe("current");
    const afterVerdict = buildReviewBasis({ requirements: [...REQUIREMENTS.slice(1), REJECTED], lm: LM, sectionLSummary: "", sectionMSummary: "" });
    expect(reviewFreshness(result, afterVerdict.hash)).toBe("stale");
  });

  it("waits for a finished parse", async () => {
    const id = await parsedSolicitation({ parseStatus: "parsing" });
    const res = await runSolicitationReviewAction(id);
    expect(res).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("scores every requirement a window at a time, re-reading a cut-off window in halves", async () => {
    const id = await parsedSolicitation();
    await runSolicitationReviewAction(id);
    const [review] = await db.select().from(solicitationReviews).where(and(eq(solicitationReviews.organizationId, fx.orgA.organizationId), eq(solicitationReviews.solicitationId, id)));
    const ids = review!.result.requirements.map((r) => r.id);
    calls = [];
    cutWhenLarger = { id: ids[2]!, above: 10 }; // the first window (20) is cut off; its halves (10) are not

    const res = await runCapabilityMatrixAction(id);
    expect(res).toMatchObject({ ok: true, cellCount: 45, unscoredCount: 0, pwinLow: 40, pwinHigh: 55 });
    const cellCalls = calls.filter((c) => c.tool === "record_capability_cells");
    expect(cellCalls.map((c) => c.ids.length)).toEqual(expect.arrayContaining([20, 10, 10, 20, 5]));
    expect(cellCalls).toHaveLength(5);
    expect(calls.filter((c) => c.tool === "record_pwin_recommendation")).toHaveLength(1);

    const [matrix] = await db.select().from(solicitationCapabilityMatrices).where(and(eq(solicitationCapabilityMatrices.organizationId, fx.orgA.organizationId), eq(solicitationCapabilityMatrices.solicitationId, id)));
    expect(matrix!.cells.map((c) => c.requirementId)).toEqual(ids); // in the review's order
    expect(new Set(matrix!.cells.map((c) => c.status))).toEqual(new Set(["gap", "strong"]));
  });

  it("leaves a window that fails twice for Score remaining, which scores only what is missing", async () => {
    const id = await parsedSolicitation();
    await runSolicitationReviewAction(id);
    const [review] = await db.select().from(solicitationReviews).where(and(eq(solicitationReviews.organizationId, fx.orgA.organizationId), eq(solicitationReviews.solicitationId, id)));
    const ids = review!.result.requirements.map((r) => r.id);
    cutWhenLarger = { id: ids[25]!, above: 1 }; // second window: cut off whole and in halves

    const first = await runCapabilityMatrixAction(id);
    expect(first).toMatchObject({ ok: true, cellCount: 35, unscoredCount: 10 });

    calls = [];
    cutWhenLarger = null;
    const rest = await runCapabilityMatrixAction(id);
    expect(rest).toMatchObject({ ok: true, cellCount: 45, unscoredCount: 0 });
    const cellCalls = calls.filter((c) => c.tool === "record_capability_cells");
    expect(cellCalls).toHaveLength(1);
    expect(cellCalls[0]!.ids).toHaveLength(10);
    expect(cellCalls[0]!.ids).toContain(ids[25]);

    // Re-running the review keeps the matrix: the ids are the same.
    await runSolicitationReviewAction(id);
    const [matrix] = await db.select().from(solicitationCapabilityMatrices).where(and(eq(solicitationCapabilityMatrices.organizationId, fx.orgA.organizationId), eq(solicitationCapabilityMatrices.solicitationId, id)));
    expect(matrix!.cells).toHaveLength(45);
  });

  it("counts a window whose call errors as unscored and still scores the rest", async () => {
    const id = await parsedSolicitation();
    await runSolicitationReviewAction(id);
    const [review] = await db.select().from(solicitationReviews).where(and(eq(solicitationReviews.organizationId, fx.orgA.organizationId), eq(solicitationReviews.solicitationId, id)));
    const ids = review!.result.requirements.map((r) => r.id);
    errorFor = ids[44]!; // the last window (5 requirements), whole and in halves

    const res = await runCapabilityMatrixAction(id);
    expect(res).toMatchObject({ ok: true, cellCount: 40 });
    expect((res as { unscoredCount: number }).unscoredCount).toBeGreaterThan(0);
    expect((res as { unscoredCount: number }).unscoredCount).toBeLessThanOrEqual(5);
    expect(calls.filter((c) => c.tool === "record_pwin_recommendation")).toHaveLength(1);
  });

  it("keeps another organization's solicitation out of reach", async () => {
    const [other] = await db
      .insert(solicitations)
      .values({ organizationId: fx.orgB.organizationId, title: "B's RFP", parseStatus: "parsed", rawText: "x", extractedRequirements: REQUIREMENTS })
      .returning({ id: solicitations.id });
    expect(await runSolicitationReviewAction(other!.id)).toEqual({ ok: false, error: "Solicitation not found." });
    expect(await runCapabilityMatrixAction(other!.id)).toEqual({ ok: false, error: "Solicitation not found." });
    expect(calls).toHaveLength(0);
  });
});
