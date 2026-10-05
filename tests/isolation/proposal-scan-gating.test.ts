/**
 * BL-AIX Phase 0c — a proposal the background scan may not run (its plan
 * lacks the feature) leaves the queue instead of sitting first in it.
 * Five such proposals used to stop background scans for every tenant.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposals } from "@/db/schema";
import { runStaleProposalScans } from "@/lib/proposal-scan-cron";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIX Phase 0c — scan queue with gated proposals", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("scangate");
    tiers = [await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `sg-b-${tag}`, name: "SG B" })];
  });

  afterEach(async () => {
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
  });

  it("a proposal whose plan lacks the scan leaves the background queue", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    await db.update(proposals).set({ scanDirtySince: tenMinutesAgo }).where(and(eq(proposals.id, fx.orgB.proposalId), eq(proposals.organizationId, fx.orgB.organizationId)));
    const summary = await runStaleProposalScans(5);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    const [p] = await db.select({ scanDirtySince: proposals.scanDirtySince }).from(proposals).where(and(eq(proposals.id, fx.orgB.proposalId), eq(proposals.organizationId, fx.orgB.organizationId)));
    expect(p!.scanDirtySince).toBeNull();
  });
});
