/**
 * BL-AIP-4c — durable background jobs against Postgres.
 *
 * Two tenants. Asserts: a parse job whose file bytes are gone fails at
 * once and marks the solicitation row failed with the reason; an open
 * job for the same resource is reused rather than duplicated; the cron
 * re-queues a stuck `running` row (and fails one whose attempts are
 * spent) and then runs due rows; a harvest with nothing to harvest is a
 * permanent failure; tenant B can neither claim nor see A's jobs.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, solicitations } from "@/db/schema";
import {
  BYTES_GONE_ERROR,
  enqueueJob,
  executeJob,
  latestJobForResource,
  runJobsCron,
} from "@/lib/jobs";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

async function jobRow(id: string) {
  const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1);
  return row!;
}

describe("BL-AIP-4c — background jobs", () => {
  let fx: TwoTenantFixture;
  let solicitationId: string;

  beforeEach(async () => {
    fx = await createTwoTenants("background-jobs");
    const [s] = await db
      .insert(solicitations)
      .values({
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        title: "Jobs test RFP",
        fileName: "rfp.pdf",
        parseStatus: "parsing",
        storagePath: "", // bytes never stored
      })
      .returning({ id: solicitations.id });
    solicitationId = s!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("fails a parse permanently when the bytes are gone and records it on the row", async () => {
    const { job, reused } = await enqueueJob({
      organizationId: fx.orgA.organizationId,
      kind: "solicitation_parse",
      resourceId: solicitationId,
      requestedByUserId: fx.orgA.userId,
    });
    expect(reused).toBe(false);
    expect(job.status).toBe("queued");

    const again = await enqueueJob({
      organizationId: fx.orgA.organizationId,
      kind: "solicitation_parse",
      resourceId: solicitationId,
    });
    expect(again).toMatchObject({ reused: true, job: { id: job.id } });

    const res = await executeJob(job.id, fx.orgA.organizationId, { viaCron: true });
    expect(res).toEqual({ ran: true, ok: false, error: BYTES_GONE_ERROR, retryScheduled: false });

    const after = await jobRow(job.id);
    expect(after.status).toBe("failed");
    expect(after.attempts).toBe(1);
    expect(after.finishedAt).not.toBeNull();

    const [sol] = await db
      .select({ parseStatus: solicitations.parseStatus, parseError: solicitations.parseError })
      .from(solicitations)
      .where(eq(solicitations.id, solicitationId));
    expect(sol).toEqual({ parseStatus: "failed", parseError: BYTES_GONE_ERROR });

    // A closed job no longer blocks a fresh one (Re-parse enqueues anew).
    const fresh = await enqueueJob({
      organizationId: fx.orgA.organizationId,
      kind: "solicitation_parse",
      resourceId: solicitationId,
    });
    expect(fresh.reused).toBe(false);
    expect(fresh.job.id).not.toBe(job.id);
  });

  it("recovers stuck rows on the cron tick and runs due rows", async () => {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000);
    const [stuck] = await db
      .insert(backgroundJobs)
      .values({
        organizationId: fx.orgA.organizationId,
        kind: "solicitation_parse",
        resourceId: solicitationId,
        status: "running",
        attempts: 1,
        startedAt: twentyMinutesAgo,
      })
      .returning({ id: backgroundJobs.id });
    const [spent] = await db
      .insert(backgroundJobs)
      .values({
        organizationId: fx.orgB.organizationId,
        kind: "proposal_harvest",
        resourceId: fx.orgB.proposalId,
        status: "running",
        attempts: 3,
        startedAt: twentyMinutesAgo,
      })
      .returning({ id: backgroundJobs.id });
    const [fresh] = await db
      .insert(backgroundJobs)
      .values({
        organizationId: fx.orgA.organizationId,
        kind: "proposal_harvest",
        resourceId: fx.orgA.proposalId,
        status: "running",
        attempts: 1,
        startedAt: new Date(),
      })
      .returning({ id: backgroundJobs.id });

    const summary = await runJobsCron({ maxJobs: 10 });
    expect(summary.recovered).toBeGreaterThanOrEqual(1);
    expect(summary.abandoned).toBeGreaterThanOrEqual(1);

    // The spent row failed; the fresh row is untouched; the stuck row
    // was re-queued and then ran in the same tick (bytes gone → failed).
    expect((await jobRow(spent!.id)).status).toBe("failed");
    expect((await jobRow(spent!.id)).error).toContain("died with its instance");
    expect((await jobRow(fresh!.id)).status).toBe("running");
    const recovered = await jobRow(stuck!.id);
    expect(recovered.attempts).toBe(2);
    expect(recovered.status).toBe("failed");
    expect(recovered.error).toBe(BYTES_GONE_ERROR);
  });

  it("fails a harvest with nothing to harvest without retrying", async () => {
    const { job } = await enqueueJob({
      organizationId: fx.orgA.organizationId,
      kind: "proposal_harvest",
      resourceId: fx.orgA.proposalId,
      requestedByUserId: fx.orgA.userId,
    });
    const res = await executeJob(job.id, fx.orgA.organizationId, { viaCron: false });
    expect(res).toMatchObject({ ran: true, ok: false, retryScheduled: false });
    expect((res as { error: string }).error).toContain("no sections");
    expect((await jobRow(job.id)).status).toBe("failed");
  });

  it("is tenant-isolated: B cannot claim or see A's job", async () => {
    const { job } = await enqueueJob({
      organizationId: fx.orgA.organizationId,
      kind: "solicitation_parse",
      resourceId: solicitationId,
    });

    const cross = await executeJob(job.id, fx.orgB.organizationId, { viaCron: true });
    expect(cross).toEqual({ ran: false, reason: "not_claimable" });
    expect((await jobRow(job.id)).status).toBe("queued");

    expect(
      await latestJobForResource({
        organizationId: fx.orgB.organizationId,
        kind: "solicitation_parse",
        resourceId: solicitationId,
      }),
    ).toBeNull();
    const own = await latestJobForResource({
      organizationId: fx.orgA.organizationId,
      kind: "solicitation_parse",
      resourceId: solicitationId,
    });
    expect(own?.id).toBe(job.id);

    // B's own enqueue for A's solicitation id creates B's row, which
    // then fails at once: the handler cannot see A's solicitation.
    const bogus = await enqueueJob({
      organizationId: fx.orgB.organizationId,
      kind: "solicitation_parse",
      resourceId: solicitationId,
    });
    const res = await executeJob(bogus.job.id, fx.orgB.organizationId, { viaCron: true });
    expect(res).toMatchObject({ ran: true, ok: false, error: "Solicitation no longer exists." });
    const [sol] = await db
      .select({ parseStatus: solicitations.parseStatus })
      .from(solicitations)
      .where(and(eq(solicitations.id, solicitationId), eq(solicitations.organizationId, fx.orgA.organizationId)));
    expect(sol?.parseStatus).toBe("parsing");
  });
});
