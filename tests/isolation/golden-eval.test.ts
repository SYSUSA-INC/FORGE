/**
 * BL-AIP-5b (part ii) — the golden set, against Postgres.
 *
 * Two tenants. A won outcome on tenant A's proposal makes its written
 * sections golden cases for A only; sections below the word floor are
 * left out; tenant B sees none of A's cases and has none of its own.
 * Run history is read per organization. BL-AIX Phase 1i-2 — a candidate
 * model the deployment cannot serve is refused before any model call.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiEvalRuns, proposalOutcomes, proposalSections } from "@/db/schema";
import { __setCompleteImplForTest } from "@/lib/ai";
import { GOLDEN_MIN_WORDS, listEvalRuns, listGoldenCases, runGoldenEval } from "@/lib/golden-eval";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-5b — golden eval set", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("golden-eval");
    await db.insert(proposalSections).values([
      {
        proposalId: fx.orgA.proposalId,
        kind: "technical",
        title: "Technical Approach",
        ordering: 1,
        content: "won text",
        wordCount: GOLDEN_MIN_WORDS + 50,
      },
      {
        proposalId: fx.orgA.proposalId,
        kind: "executive_summary",
        title: "Executive Summary",
        ordering: 2,
        content: "too short",
        wordCount: GOLDEN_MIN_WORDS - 1,
      },
      {
        proposalId: fx.orgB.proposalId,
        kind: "technical",
        title: "B Technical",
        ordering: 1,
        content: "not won",
        wordCount: GOLDEN_MIN_WORDS + 50,
      },
    ]);
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await fx.cleanup();
  });

  it("only won proposals' long sections are cases, per organization", async () => {
    expect(await listGoldenCases({ organizationId: fx.orgA.organizationId })).toEqual([]);

    await db.insert(proposalOutcomes).values({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      outcomeType: "won",
    });
    const casesA = await listGoldenCases({ organizationId: fx.orgA.organizationId });
    expect(casesA.map((c) => [c.sectionTitle, c.proposalId])).toEqual([
      ["Technical Approach", fx.orgA.proposalId],
    ]);

    // B's proposal was never won, and B cannot see A's cases.
    expect(await listGoldenCases({ organizationId: fx.orgB.organizationId })).toEqual([]);
  });

  it("run history is per organization", async () => {
    await db.insert(aiEvalRuns).values({
      organizationId: fx.orgA.organizationId,
      promptVersion: "test",
      model: "stub",
      caseCount: 1,
      meanScore: 0.5,
      results: [],
      stubbed: true,
      requestedByUserId: fx.orgA.userId,
    });
    const runsA = await listEvalRuns({ organizationId: fx.orgA.organizationId });
    expect(runsA).toHaveLength(1);
    expect(runsA[0]).toMatchObject({ promptVersion: "test", meanScore: 0.5, stubbed: true });
    expect(await listEvalRuns({ organizationId: fx.orgB.organizationId })).toEqual([]);
  });

  it("refuses a candidate model the stub provider cannot serve, before any model call", async () => {
    await db.insert(proposalOutcomes).values({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      outcomeType: "won",
    });
    let calls = 0;
    __setCompleteImplForTest(async () => {
      calls += 1;
      throw new Error("no model call expected");
    });
    // The test environment has no provider key, so the gateway is in stub mode.
    const res = await runGoldenEval({
      organizationId: fx.orgA.organizationId,
      actor: { userId: fx.orgA.userId },
      model: "claude-sonnet-5-5",
    });
    expect(res).toEqual({ ok: false, error: "Candidate models need the Anthropic provider; this deployment uses another." });
    expect(calls).toBe(0);
    expect(await db.select().from(aiEvalRuns).where(eq(aiEvalRuns.organizationId, fx.orgA.organizationId))).toEqual([]);
  });
});
