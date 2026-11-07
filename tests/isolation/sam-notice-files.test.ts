/**
 * BL-SCOUT-FILES — adding a SAM.gov find to the pipeline queues the
 * download of the notice's attachments at once (a `sam_notice_files` job
 * on the new opportunity), rather than leaving them for the next daily
 * check; a find with no SAM.gov notice (a watchlisted award) queues
 * nothing; a check that can't run fails the job, so it is retried and
 * shown, never silently dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, opportunities, scoutCandidates } from "@/db/schema";
import { decideScoutCandidate } from "@/lib/scout";
import { handleSamNoticeFiles } from "@/lib/sam-notice-files";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-SCOUT-FILES — a new opportunity's SAM.gov attachments", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("sam-notice-files");
    // No SAM.gov key and no network: the queued check can't reach SAM.gov here.
    vi.stubEnv("SAMGOV_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  const find = async (over: Partial<typeof scoutCandidates.$inferInsert>) => {
    const [c] = await db
      .insert(scoutCandidates)
      .values({ organizationId: fx.orgA.organizationId, source: "org_naics", noticeId: `nf-${Math.random().toString(36).slice(2, 8)}`, title: "Help desk", agency: "VA", naicsCode: "541512", noticeType: "Sources Sought", fitScore: 70, ...over })
      .returning({ id: scoutCandidates.id });
    return c!.id;
  };
  const jobsFor = (opportunityId: string) =>
    db.select().from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), eq(backgroundJobs.kind, "sam_notice_files"), eq(backgroundJobs.resourceId, opportunityId)));

  it("queues the download when a SAM.gov find is added", async () => {
    const res = await decideScoutCandidate({ organizationId: fx.orgA.organizationId, candidateId: await find({}), decision: "imported", actor: { userId: fx.orgA.userId, email: "a@test" } });
    expect(res.ok && res.opportunityId).toBeTruthy();
    if (!res.ok) return;
    const [opp] = await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, res.opportunityId!));
    expect(opp!.stage).toBe("sources_sought");
    expect(await jobsFor(res.opportunityId!)).toHaveLength(1);
  });

  it("queues nothing for a find with no SAM.gov notice", async () => {
    const res = await decideScoutCandidate({ organizationId: fx.orgA.organizationId, candidateId: await find({ source: "watchlist_award", noticeId: "award:abc" }), decision: "imported", actor: { userId: fx.orgA.userId, email: "a@test" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await jobsFor(res.opportunityId!)).toHaveLength(0);
  });

  it("fails the job when the check can't run, so it is retried and shown", async () => {
    await expect(handleSamNoticeFiles({ organizationId: fx.orgA.organizationId, resourceId: fx.orgA.opportunityId })).rejects.toThrow();
  });
});
