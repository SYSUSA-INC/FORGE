/**
 * BL-AIP-7b part ii — nightly PWin snapshots and movers against
 * Postgres. Two tenants. Asserts: the nightly run freezes a snapshot for
 * a live opportunity and then skips it while nothing moved; movers are
 * computed from each organization's own snapshots only; the Brier track
 * ignores nightly rows.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pwinSnapshots } from "@/db/schema";
import { getPwinTrack } from "@/lib/pwin";
import { listPwinMovers, snapshotOrganizationPwin } from "@/lib/pwin-nightly";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const DAY_MS = 24 * 60 * 60_000;

describe("BL-AIP-7b part ii — nightly PWin snapshots", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("pwin-nightly");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("freezes a nightly snapshot once, then skips an unchanged estimate, per organization", async () => {
    const first = await snapshotOrganizationPwin({ organizationId: fx.orgA.organizationId });
    expect(first).toEqual({ opportunities: 1, snapshotted: 1, unchanged: 0, errors: 0 });

    const rows = await db
      .select({ trigger: pwinSnapshots.trigger, pwin: pwinSnapshots.pwin, organizationId: pwinSnapshots.organizationId })
      .from(pwinSnapshots)
      .where(eq(pwinSnapshots.opportunityId, fx.orgA.opportunityId));
    expect(rows).toEqual([{ trigger: "nightly", pwin: 30, organizationId: fx.orgA.organizationId }]);

    const second = await snapshotOrganizationPwin({ organizationId: fx.orgA.organizationId });
    expect(second).toEqual({ opportunities: 1, snapshotted: 0, unchanged: 1, errors: 0 });

    // B was never touched.
    const bRows = await db
      .select({ id: pwinSnapshots.id })
      .from(pwinSnapshots)
      .where(eq(pwinSnapshots.organizationId, fx.orgB.organizationId));
    expect(bRows).toEqual([]);

    // Nightly rows never enter the Brier track.
    expect(await getPwinTrack(fx.orgA.organizationId)).toEqual({ n: 0, brier: null });
  });

  it("lists movers from each organization's own snapshots only", async () => {
    const now = new Date();
    const factorsThen = [{ key: "evaluation", label: "Evaluation", logOdds: -0.4, detail: "rollup 2/5" }];
    const factorsNow = [{ key: "evaluation", label: "Evaluation", logOdds: 0.6, detail: "rollup 4/5" }];
    await db.insert(pwinSnapshots).values([
      {
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        probability: 0.3,
        pwin: 30,
        confidence: "low",
        factors: factorsThen,
        modelVersion: "v1",
        trigger: "nightly",
        createdAt: new Date(now.getTime() - 5 * DAY_MS),
      },
      {
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        probability: 0.48,
        pwin: 48,
        confidence: "medium",
        factors: factorsNow,
        modelVersion: "v1",
        trigger: "nightly",
        createdAt: new Date(now.getTime() - 1 * DAY_MS),
      },
      // A stale baseline outside the window must not count.
      {
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        probability: 0.1,
        pwin: 10,
        confidence: "low",
        factors: [],
        modelVersion: "v1",
        trigger: "nightly",
        createdAt: new Date(now.getTime() - 20 * DAY_MS),
      },
      {
        organizationId: fx.orgB.organizationId,
        opportunityId: fx.orgB.opportunityId,
        probability: 0.7,
        pwin: 70,
        confidence: "high",
        factors: [],
        modelVersion: "v1",
        trigger: "nightly",
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
      },
    ]);

    const a = await listPwinMovers({ organizationId: fx.orgA.organizationId, now });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      opportunityId: fx.orgA.opportunityId,
      from: 30,
      to: 48,
      delta: 18,
      days: 4,
      confidence: "medium",
      reasons: ["▲ Evaluation: rollup 4/5"],
      title: expect.stringContaining("opp"),
      stage: "identified",
    });
    // B has one snapshot: no move, and none of A's.
    expect(await listPwinMovers({ organizationId: fx.orgB.organizationId, now })).toEqual([]);

    // A's rows are still A's.
    const aRows = await db
      .select({ id: pwinSnapshots.id })
      .from(pwinSnapshots)
      .where(and(eq(pwinSnapshots.organizationId, fx.orgA.organizationId), eq(pwinSnapshots.trigger, "nightly")));
    expect(aRows).toHaveLength(3);
  });
});
