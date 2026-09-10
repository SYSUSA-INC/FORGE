/**
 * BL-FB-X-PWIN-MODEL — runtime tests for the server side.
 *
 * Pins: an unscored opportunity returns the default prior, the
 * evaluation moves the estimate, tenant isolation, and the outcome
 * snapshot path that produces a Brier grade.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunityEvaluations, pwinSnapshots } from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";
import { computePwin, getPwinTrack, recordPwinOutcome, snapshotPwin } from "@/lib/pwin";
import { DEFAULT_BASE_RATE } from "@/lib/pwin-model";

describe("BL-FB-X-PWIN-MODEL — computePwin (runtime)", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("pwin");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("returns the default prior, low confidence and no factors for an unscored opportunity", async () => {
    const est = await computePwin(fx.orgA.organizationId, fx.orgA.opportunityId);
    expect(est).not.toBeNull();
    expect(est!.prior.n).toBe(0);
    expect(est!.prior.baseRate).toBeCloseTo(DEFAULT_BASE_RATE, 5);
    expect(est!.score.pwin).toBe(30);
    expect(est!.score.confidence).toBe("low");
    expect(est!.score.factors).toEqual([]);
    expect(est!.calibration.applied).toBe(false);
    expect(est!.proposalId).toBe(fx.orgA.proposalId);
    expect(est!.track).toEqual({ n: 0, brier: null });
  });

  it("a strong evaluation raises the estimate and confidence", async () => {
    await db.insert(opportunityEvaluations).values({
      opportunityId: fx.orgA.opportunityId,
      strategicFit: 85,
      customerRelationship: 90,
      competitivePosture: 80,
      resourceAvailability: 75,
      financialAttractiveness: 60,
    });
    const est = await computePwin(fx.orgA.organizationId, fx.orgA.opportunityId);
    expect(est!.score.pwin).toBeGreaterThan(55);
    expect(est!.score.confidence).toBe("medium");
    expect(est!.score.factors.map((f) => f.key)).toContain("eval_customerRelationship");
  });

  it("is tenant-isolated: another org cannot score this opportunity", async () => {
    expect(await computePwin(fx.orgB.organizationId, fx.orgA.opportunityId)).toBeNull();
  });

  it("outcome snapshots grade the model with a Brier score", async () => {
    const recorded = await recordPwinOutcome({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      outcome: "lost",
    });
    expect(recorded).toBe(true);

    const rows = await db
      .select()
      .from(pwinSnapshots)
      .where(eq(pwinSnapshots.organizationId, fx.orgA.organizationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trigger).toBe("outcome");
    expect(rows[0]!.outcome).toBe("lost");
    expect(rows[0]!.opportunityId).toBe(fx.orgA.opportunityId);
    expect(rows[0]!.probability).toBeCloseTo(DEFAULT_BASE_RATE, 2);

    const track = await getPwinTrack(fx.orgA.organizationId);
    expect(track.n).toBe(1);
    // Predicted 0.30 for a loss → (0.30 - 0)^2 = 0.09.
    expect(track.brier).toBeCloseTo(0.09, 2);

    // Tenant B's grade is untouched.
    expect(await getPwinTrack(fx.orgB.organizationId)).toEqual({ n: 0, brier: null });

    // An 'apply' snapshot does not count toward the grade.
    const est = await computePwin(fx.orgA.organizationId, fx.orgA.opportunityId);
    await snapshotPwin({ organizationId: fx.orgA.organizationId, estimate: est!, trigger: "apply" });
    expect((await getPwinTrack(fx.orgA.organizationId)).n).toBe(1);
  });

  it("a recorded outcome for a foreign proposal is refused", async () => {
    expect(
      await recordPwinOutcome({
        organizationId: fx.orgB.organizationId,
        proposalId: fx.orgA.proposalId,
        outcome: "won",
      }),
    ).toBe(false);
  });
});
