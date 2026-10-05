/**
 * BL-AIX Phase 0c — auto-draft runs on the server as durable jobs.
 *
 * CI has no AI key, so the drafter is in stub mode: the job must fail
 * with a clear reason and leave the section untouched (the old browser
 * loop wrote stub text into sections). Jobs are scoped to their tenant:
 * a job filed under another organization cannot touch the section.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, backgroundJobs, proposalSections } from "@/db/schema";
import { autoDraftProgress, pumpAutoDraft, startAutoDraft } from "@/lib/auto-draft";
import { enqueueJob, executeJob } from "@/lib/jobs";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIX Phase 0c — server-side auto-draft", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  let emptySection = "";
  let writtenSection = "";
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("autodraft");
    tiers = [
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `ad-a-${tag}`, name: "AD A", featureFlags: { aiAutoDraft: true } }),
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `ad-b-${tag}`, name: "AD B" }),
    ];
    const rows = await db
      .insert(proposalSections)
      .values([
        { proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach", ordering: 1 },
        { proposalId: fx.orgA.proposalId, kind: "management", title: "Management plan", ordering: 2, content: "Already written. ".repeat(40), wordCount: 80 },
      ])
      .returning({ id: proposalSections.id });
    emptySection = rows[0]!.id;
    writtenSection = rows[1]!.id;
  });

  afterEach(async () => {
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
  });

  it("queues empty sections once, refuses other tenants and gated plans", async () => {
    const actor = { organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, userId: fx.orgA.userId, overwrite: false, kick: false };
    expect(await startAutoDraft({ ...actor, organizationId: fx.orgB.organizationId })).toEqual({ ok: false, error: "Proposal not found." });
    expect(await startAutoDraft({ ...actor, organizationId: fx.orgB.organizationId, proposalId: fx.orgB.proposalId })).toMatchObject({ ok: false });

    expect(await startAutoDraft(actor)).toEqual({ ok: true, queued: 1 });
    // A second click reuses the open job instead of drafting twice.
    expect(await startAutoDraft(actor)).toEqual({ ok: true, queued: 0 });
    const progress = await autoDraftProgress({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId });
    expect(progress).toMatchObject({ total: 1, queued: 1, active: true });
    expect(progress.sections[0]!.sectionId).toBe(emptySection);
    expect(progress.titles[emptySection]).toBe("Technical approach");
    // Another tenant sees none of it.
    expect(await autoDraftProgress({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId })).toMatchObject({ total: 0 });

    const started = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "proposal.auto_draft.start")));
    expect(started).toHaveLength(2);
  });

  it("never writes stub-mode text into a section", async () => {
    await startAutoDraft({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, userId: fx.orgA.userId, overwrite: false, kick: false });
    expect(await pumpAutoDraft({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId })).toEqual({ ran: 1 });

    const progress = await autoDraftProgress({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId });
    expect(progress).toMatchObject({ failed: 1, active: false });
    expect(progress.sections[0]!.note).toContain("stub mode");
    const [section] = await db.select({ wordCount: proposalSections.wordCount, content: proposalSections.content }).from(proposalSections).where(eq(proposalSections.id, emptySection));
    expect(section).toEqual({ wordCount: 0, content: "" });
    const wrote = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "proposal.section.auto_draft")));
    expect(wrote).toEqual([]);
  });

  it("a job filed under another tenant cannot touch the section", async () => {
    const { job } = await enqueueJob({
      organizationId: fx.orgB.organizationId,
      kind: "section_auto_draft",
      resourceId: writtenSection,
      payload: { proposalId: fx.orgA.proposalId, overwrite: true },
      requestedByUserId: fx.orgB.userId,
    });
    expect(await executeJob(job.id, fx.orgB.organizationId, { viaCron: true })).toMatchObject({ ran: true, ok: false, retryScheduled: false });
    const [row] = await db.select({ status: backgroundJobs.status, error: backgroundJobs.error }).from(backgroundJobs).where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.organizationId, fx.orgB.organizationId)));
    expect(row).toEqual({ status: "failed", error: "Section no longer exists." });
    const [section] = await db.select({ wordCount: proposalSections.wordCount }).from(proposalSections).where(eq(proposalSections.id, writtenSection));
    expect(section!.wordCount).toBe(80);
  });
});
