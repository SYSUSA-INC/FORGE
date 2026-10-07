/**
 * BL-AIX Phase 1h-2 — the draft judge and expert ratings against
 * Postgres, with the model mocked.
 *
 * Asserts: the judge reads only the organization's own section and
 * returns cleaned scores; an expert's rating is stored once per draft
 * (re-rating replaces it) and only for a stored draft of the
 * organization's own run; another organization can neither rate the run
 * nor see the ratings; calibration pairs the rating with the judge.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiEvalRatings, aiEvalRuns, proposalSections } from "@/db/schema";
import { __setCompleteImplForTest } from "@/lib/ai";
import { judgeSectionDraft } from "@/lib/draft-judge";
import { loadRatingsAndCalibration, rateGoldenDraft } from "@/lib/eval-ratings";
import type { GoldenCaseResult } from "@/lib/golden-holdout";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const SCORES = { compliance: 4, evaluation: 3, specificity: 5, clarity: 4, overall: 4 };

describe("BL-AIX Phase 1h-2 — draft judge and expert ratings (runtime)", () => {
  let fx: TwoTenantFixture;
  let sectionId: string;
  let runId: string;
  let seen: string[] = [];

  beforeEach(async () => {
    fx = await createTwoTenants("eval-ratings");
    const [s] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical Approach", instructions: "Describe the migration.", content: "Won text.", wordCount: 2 })
      .returning({ id: proposalSections.id });
    sectionId = s!.id;
    const results: GoldenCaseResult[] = [
      {
        proposalId: fx.orgA.proposalId,
        sectionId,
        sectionTitle: "Technical Approach",
        sectionKind: "technical",
        agency: "GSA",
        goldenWords: 2,
        draftWords: 9,
        score: 0.5,
        termCoverage: 0.5,
        lengthFit: 0.5,
        specificity: 0.5,
        placeholderRate: 0,
        themeCoverage: null,
        draft: "We migrate in three reversible waves with tested rollback.",
        judge: { scores: SCORES, rationale: "Clear.", model: "judge-test" },
      },
    ];
    const [run] = await db
      .insert(aiEvalRuns)
      .values({ organizationId: fx.orgA.organizationId, feature: "section_draft", caseCount: 1, meanScore: 0.5, results })
      .returning({ id: aiEvalRuns.id });
    runId = run!.id;

    seen = [];
    __setCompleteImplForTest(async (opts) => {
      seen.push(opts.messages.map((m) => m.content).join("\n"));
      return {
        text: "",
        provider: "anthropic" as const,
        model: "judge-test",
        inputTokens: 10,
        outputTokens: 10,
        stubbed: false,
        structured: { compliance: 4.4, evaluation: 3, specificity: 5, clarity: 4, overall: 4, rationale: " Strong rollback detail. " },
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await fx.cleanup();
  });

  it("judges the organization's own section only", async () => {
    const res = await judgeSectionDraft({ organizationId: fx.orgA.organizationId, sectionId, draft: "We migrate in waves." });
    expect(res).toEqual({ scores: { compliance: 4, evaluation: 3, specificity: 5, clarity: 4, overall: 4 }, rationale: "Strong rollback detail.", model: "judge-test" });
    expect(seen[0]).toContain("Describe the migration.");
    expect(seen[0]).toContain("We migrate in waves.");

    expect(await judgeSectionDraft({ organizationId: fx.orgB.organizationId, sectionId, draft: "x" })).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it("stores one rating per expert per draft, refuses other organizations, and calibrates against the judge", async () => {
    const rate = (scores: Partial<typeof SCORES>, organizationId = fx.orgA.organizationId, raterUserId = fx.orgA.userId) =>
      rateGoldenDraft({ organizationId, runId, sectionId, raterUserId, scores, note: "ok" });

    expect(await rate({ ...SCORES, overall: 2 })).toEqual({ ok: true });
    expect(await rate({ ...SCORES, overall: 3 })).toEqual({ ok: true });
    const rows = await db.select().from(aiEvalRatings).where(eq(aiEvalRatings.runId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: fx.orgA.organizationId, overall: 3 });

    expect(await rate({ compliance: 3 })).toMatchObject({ ok: false });
    expect(await rateGoldenDraft({ organizationId: fx.orgA.organizationId, runId, sectionId: fx.orgA.proposalId, raterUserId: fx.orgA.userId, scores: SCORES, note: "" })).toMatchObject({ ok: false });
    expect(await rate(SCORES, fx.orgB.organizationId, fx.orgB.userId)).toEqual({ ok: false, error: "Eval run not found." });

    const a = await loadRatingsAndCalibration({ organizationId: fx.orgA.organizationId, runIds: [runId] });
    expect(a.ratings).toHaveLength(1);
    expect(a.calibration.overall).toMatchObject({ n: 1, meanAbsDiff: 1, withinOne: 1, verdict: "collecting" });
    expect(a.calibration.perDimension.compliance).toBe(0);
    const b = await loadRatingsAndCalibration({ organizationId: fx.orgB.organizationId, runIds: [runId] });
    expect(b.ratings).toHaveLength(0);
    expect(b.calibration.overall.n).toBe(0);
  });
});
