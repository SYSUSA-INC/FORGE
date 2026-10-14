/**
 * BL-STAB-2d — the upload sweeper (Postgres; memory storage stands in for
 * R2): uploads that never arrived or were never filed are failed and
 * deleted; filings that died are finished when their record holds the
 * file and failed once the day to retry is over; what is due is deleted
 * again, never a kept file and never a key not built for its upload; old
 * rows are pruned; another organization's live uploads are untouched.
 * Time is moved on each row (never the sweep's clock), so nothing else
 * in the database is due.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, fileUploads, solicitations, type FileUpload } from "@/db/schema";
import { queueMissingParse } from "@/lib/jobs";
import { log } from "@/lib/log";
import { getStorageProvider } from "@/lib/storage";
import { cancelUpload, claimUpload, completeUpload, createUploadIntent, finishClaim, releaseClaim, sweepUploads } from "@/lib/uploads";
import type { UploadPurpose } from "@/lib/upload-policy";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const TEXT = new TextEncoder().encode("Section C. The contractor shall staff the help desk.\n");
const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);

/**
 * Run `between` just before the sweep's first UPDATE whose values match
 * `when`, as if another request landed between the sweep's read and its
 * write. Every other update (including `between`'s own) passes through.
 */
function raceBeforeUpdate(when: (values: Record<string, unknown>) => boolean, between: () => Promise<unknown>) {
  const real = db.update.bind(db);
  let fired = false;
  return vi.spyOn(db, "update").mockImplementation(((table: Parameters<typeof db.update>[0]) => {
    const builder = real(table);
    const set = builder.set.bind(builder);
    builder.set = ((values: Record<string, unknown>) => {
      const next = set(values as never);
      if (fired || !when(values)) return next;
      fired = true;
      const where = next.where.bind(next);
      next.where = ((cond: unknown) => {
        const q = where(cond as never);
        const returning = q.returning.bind(q);
        q.returning = ((cols: unknown) =>
          (async () => {
            await between();
            return returning(cols as never);
          })()) as never;
        return q;
      }) as never;
      return next;
    }) as never;
    return builder;
  }) as never);
}

describe("BL-STAB-2d — upload sweeper (runtime)", () => {
  let fx: TwoTenantFixture;
  const storage = () => getStorageProvider();

  beforeEach(async () => {
    fx = await createTwoTenants("uploads-sweep");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fx.cleanup();
  });

  const org = (which: "A" | "B") => (which === "A" ? fx.orgA : fx.orgB);

  async function arrived(which: "A" | "B" = "A", purpose: UploadPurpose = "document") {
    const { organizationId, userId } = org(which);
    const res = await createUploadIntent({ organizationId, actor: { userId, email: null }, purpose, fileName: "notes.txt", size: TEXT.byteLength, origin: "" });
    if (!res.ok) throw new Error(res.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, organizationId), eq(fileUploads.id, res.uploadId)));
    await storage().put({ key: row!.storageKey, bytes: TEXT, contentType: row!.contentType });
    return { id: res.uploadId, key: row!.storageKey, organizationId, userId };
  }

  async function stored(which: "A" | "B" = "A", purpose: UploadPurpose = "document") {
    const up = await arrived(which, purpose);
    const done = await completeUpload({ organizationId: up.organizationId, actor: { userId: up.userId, email: null }, uploadId: up.id });
    if (!done.ok) throw new Error(done.error);
    return up;
  }

  async function claiming(which: "A" | "B" = "A") {
    const up = await stored(which);
    const claim = await claimUpload({ organizationId: up.organizationId, userId: up.userId, uploadId: up.id, resourceType: "solicitation" });
    if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
    return { ...up, resourceId: claim.claim.resourceId };
  }

  const set = (up: { id: string; organizationId: string }, change: Partial<FileUpload>) =>
    db.update(fileUploads).set(change).where(and(eq(fileUploads.organizationId, up.organizationId), eq(fileUploads.id, up.id)));
  const row = async (up: { id: string; organizationId: string }) =>
    (await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, up.organizationId), eq(fileUploads.id, up.id))))[0];
  const kept = async (key: string) => (await storage().head(key)) !== null;

  it("fails and deletes uploads that never arrived or were never filed, and leaves live ones alone", async () => {
    const never = await arrived();
    await set(never, { purgeAfter: ago(MINUTE) });
    const unfiled = await stored();
    await set(unfiled, { purgeAfter: ago(MINUTE) });
    const live = await stored();
    const otherOrg = await stored("B");

    const sweep = await sweepUploads();
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    expect(sweep.unclaimed).toBeGreaterThanOrEqual(1);
    expect(await row(never)).toMatchObject({ status: "failed", failureReason: "expired", purgedAt: expect.any(Date) });
    expect(await row(unfiled)).toMatchObject({ status: "failed", failureReason: "unclaimed", purgedAt: expect.any(Date) });
    expect(await kept(never.key)).toBe(false);
    expect(await kept(unfiled.key)).toBe(false);
    expect(await claimUpload({ organizationId: unfiled.organizationId, userId: unfiled.userId, uploadId: unfiled.id, resourceType: "solicitation" })).toEqual({
      ok: false,
      error: "The upload was not saved within a day and was removed. Upload it again.",
    });
    for (const up of [live, otherOrg]) {
      expect(await row(up)).toMatchObject({ status: "stored", purgedAt: null });
      expect(await kept(up.key)).toBe(true);
    }
    // Deleted once: the next tick doesn't select them again.
    const del = vi.spyOn(storage(), "delete");
    await sweepUploads();
    expect(del.mock.calls.map((c) => c[0])).not.toContain(never.key);
    expect(del.mock.calls.map((c) => c[0])).not.toContain(unfiled.key);
  });

  it("keeps a file whose record was saved though its claim was put back, and queues the parse it never got", async () => {
    // The insert landed but reported an error (a dropped connection after commit), so the claim was released.
    const up = await claiming();
    await db.insert(solicitations).values({ id: up.resourceId, organizationId: up.organizationId, title: "RFP", storagePath: up.key, parseStatus: "uploaded" });
    await releaseClaim({ organizationId: up.organizationId, uploadId: up.id });
    expect(await row(up)).toMatchObject({ status: "stored", resourceId: up.resourceId });
    await set(up, { purgeAfter: ago(MINUTE) });

    // Queueing its parse fails once: the file stays and the next tick finishes it.
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    const onPromoted = vi.fn(queueMissingParse).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    await sweepUploads({ onPromoted });
    expect(await row(up)).toMatchObject({ status: "stored", purgedAt: null });
    expect(await kept(up.key)).toBe(true);
    const sweep = await sweepUploads({ onPromoted });
    expect(sweep.promoted).toBeGreaterThanOrEqual(1);
    expect(await row(up)).toMatchObject({ status: "claimed", purgeAfter: null, purgedAt: null });
    expect(await kept(up.key)).toBe(true);
    expect(onPromoted).toHaveBeenCalledWith({ organizationId: up.organizationId, resourceType: "solicitation", resourceId: up.resourceId });
    const jobs = await db
      .select({ kind: backgroundJobs.kind, status: backgroundJobs.status })
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.organizationId, up.organizationId), eq(backgroundJobs.resourceId, up.resourceId)));
    expect(jobs).toEqual([{ kind: "solicitation_parse", status: "queued" }]);
    // Never a second parse for a record that had one.
    expect(await queueMissingParse({ organizationId: up.organizationId, resourceType: "solicitation", resourceId: up.resourceId })).toBe(false);
  });

  it("a slow request never undoes or finishes a claim a retry took over", async () => {
    const up = await claiming();
    const stamp = ago(3 * MINUTE);
    await set(up, { claimedAt: stamp });
    const retry = await claimUpload({ organizationId: up.organizationId, userId: up.userId, uploadId: up.id, resourceType: "solicitation" });
    if (!retry.ok || !("claim" in retry)) throw new Error("takeover failed");
    await db.insert(solicitations).values({ id: up.resourceId, organizationId: up.organizationId, title: "RFP", storagePath: up.key, parseStatus: "uploaded" });
    // The first request's late answers change nothing.
    await releaseClaim({ organizationId: up.organizationId, uploadId: up.id, claimedAt: stamp });
    await finishClaim({ organizationId: up.organizationId, uploadId: up.id, claimedAt: stamp });
    expect(await row(up)).toMatchObject({ status: "claiming", claimedAt: retry.claim.claimedAt });
    await finishClaim({ organizationId: up.organizationId, uploadId: up.id, claimedAt: retry.claim.claimedAt });
    expect(await row(up)).toMatchObject({ status: "claimed", purgeAfter: null });
  });

  it("leaves a row another request changed between the sweep's read and its write", async () => {
    // A retry takes a dead claim over and saves its record just as the sweep gives up on it.
    const takenOver = await claiming();
    await set(takenOver, { claimedAt: ago(31 * MINUTE), purgeAfter: ago(MINUTE) });
    raceBeforeUpdate(
      (v) => v.failureReason === "claim_incomplete",
      async () => {
        const retry = await claimUpload({ organizationId: takenOver.organizationId, userId: takenOver.userId, uploadId: takenOver.id, resourceType: "solicitation" });
        expect(retry).toMatchObject({ ok: true, rerun: true });
        await db.insert(solicitations).values({ id: takenOver.resourceId, organizationId: takenOver.organizationId, title: "RFP", storagePath: takenOver.key, parseStatus: "uploaded" });
      },
    );
    await sweepUploads();
    expect(await row(takenOver)).toMatchObject({ status: "claiming", purgedAt: null });
    expect(await kept(takenOver.key)).toBe(true);
    vi.restoreAllMocks();

    // The original request finishes its claim (same stamp) just as the sweep gives up on it.
    const finished = await claiming();
    await set(finished, { claimedAt: ago(31 * MINUTE), purgeAfter: ago(MINUTE) });
    const stamp = (await row(finished))!.claimedAt!;
    raceBeforeUpdate(
      (v) => v.failureReason === "claim_incomplete",
      async () => {
        await db.insert(solicitations).values({ id: finished.resourceId, organizationId: finished.organizationId, title: "RFP", storagePath: finished.key, parseStatus: "uploaded" });
        await finishClaim({ organizationId: finished.organizationId, uploadId: finished.id, claimedAt: stamp });
      },
    );
    await sweepUploads();
    expect(await row(finished)).toMatchObject({ status: "claimed", purgedAt: null });
    expect(await kept(finished.key)).toBe(true);
    vi.restoreAllMocks();

    // A large upload's check lands just as the sweep fails it as expired.
    const late = await arrived();
    await set(late, { purgeAfter: ago(MINUTE) });
    raceBeforeUpdate(
      (v) => v.failureReason === "expired",
      () => completeUpload({ organizationId: late.organizationId, actor: { userId: late.userId, email: null }, uploadId: late.id }),
    );
    await sweepUploads();
    expect(await row(late)).toMatchObject({ status: "stored", purgedAt: null });
    expect(await kept(late.key)).toBe(true);
  });

  it("settles filings that died: finished when the record holds the file, failed once the day to retry is over", async () => {
    // The record was saved, then the instance died before the claim was finished.
    const saved = await claiming();
    await db.insert(solicitations).values({ id: saved.resourceId, organizationId: saved.organizationId, title: "RFP", storagePath: saved.key, parseStatus: "uploaded" });
    await set(saved, { claimedAt: ago(31 * MINUTE) });
    // Died before its record: the uploader can still retry within the day.
    const unsaved = await claiming();
    await set(unsaved, { claimedAt: ago(31 * MINUTE) });
    // A record with the claim's id that holds another file is not this file's record.
    const elsewhere = await claiming();
    await db.insert(solicitations).values({ id: elsewhere.resourceId, organizationId: elsewhere.organizationId, title: "Other", storagePath: "org/x/other", parseStatus: "uploaded" });
    await set(elsewhere, { claimedAt: ago(31 * MINUTE), purgeAfter: ago(MINUTE) });
    // Claimed (or taken over by a retry) a few minutes ago: still in flight.
    const recent = await claiming();
    await set(recent, { claimedAt: ago(5 * MINUTE), purgeAfter: ago(MINUTE) });
    // Died after its parse was queued and had run: it is finished, never parsed again.
    const parsed = await claiming();
    await db.insert(solicitations).values({ id: parsed.resourceId, organizationId: parsed.organizationId, title: "RFP", storagePath: parsed.key, parseStatus: "parsed" });
    await db.insert(backgroundJobs).values({ organizationId: parsed.organizationId, kind: "solicitation_parse", resourceId: parsed.resourceId, status: "done" });
    await set(parsed, { claimedAt: ago(31 * MINUTE) });

    const onPromoted = vi.fn(queueMissingParse);
    await sweepUploads({ onPromoted });
    expect(await row(saved)).toMatchObject({ status: "claimed", purgeAfter: null, purgedAt: null });
    expect(await kept(saved.key)).toBe(true);
    // The dead filing's record gets the parse it never queued; the parsed one doesn't get a second.
    const jobsFor = async (resourceId: string) =>
      db.select({ kind: backgroundJobs.kind, status: backgroundJobs.status }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), eq(backgroundJobs.resourceId, resourceId)));
    expect(await jobsFor(saved.resourceId)).toEqual([{ kind: "solicitation_parse", status: "queued" }]);
    expect(await row(parsed)).toMatchObject({ status: "claimed" });
    expect(await jobsFor(parsed.resourceId)).toEqual([{ kind: "solicitation_parse", status: "done" }]);
    expect(onPromoted.mock.calls.map((c) => c[0].resourceId).sort()).toEqual([parsed.resourceId, saved.resourceId].sort());
    expect(await row(unsaved)).toMatchObject({ status: "claiming" });
    expect(await kept(unsaved.key)).toBe(true);
    expect(await row(elsewhere)).toMatchObject({ status: "failed", failureReason: "claim_incomplete", purgedAt: expect.any(Date) });
    expect(await kept(elsewhere.key)).toBe(false);
    expect(await row(recent)).toMatchObject({ status: "claiming", purgedAt: null });

    // A retry takes the stale claim over, keeping its record id.
    const retry = await claimUpload({ organizationId: unsaved.organizationId, userId: unsaved.userId, uploadId: unsaved.id, resourceType: "solicitation" });
    expect(retry).toMatchObject({ ok: true, rerun: true, claim: { resourceId: unsaved.resourceId } });
    // The retry died too, and the day is over.
    await set(unsaved, { claimedAt: ago(31 * MINUTE), purgeAfter: ago(MINUTE) });
    const sweep = await sweepUploads();
    expect(sweep.abandoned).toBeGreaterThanOrEqual(1);
    expect(await row(unsaved)).toMatchObject({ status: "failed", failureReason: "claim_incomplete", purgedAt: expect.any(Date) });
    expect(await kept(unsaved.key)).toBe(false);
  });

  it("deletes again what is due, never a kept file, and never a key not built for its upload", async () => {
    // Cancelled, then written again by the still-valid link.
    const cancelled = await stored();
    await cancelUpload({ organizationId: cancelled.organizationId, actor: { userId: cancelled.userId, email: null }, uploadId: cancelled.id });
    await storage().put({ key: cancelled.key, bytes: TEXT, contentType: "text/plain" });
    await set(cancelled, { purgeAfter: ago(MINUTE) });
    // A chat attachment is deleted once read; a late write is deleted again.
    const chat = await stored("A", "chat_attachment");
    expect(await claimUpload({ organizationId: chat.organizationId, userId: chat.userId, uploadId: chat.id, resourceType: "section_chat_attachment" })).toMatchObject({ ok: true });
    await finishClaim({ organizationId: chat.organizationId, uploadId: chat.id });
    expect(await kept(chat.key)).toBe(false);
    expect((await row(chat))!.purgeAfter).not.toBeNull();
    await storage().put({ key: chat.key, bytes: TEXT, contentType: "text/plain" });
    await set(chat, { purgeAfter: ago(MINUTE) });
    // A file a record keeps, even with a deletion date it should never have.
    const filed = await claiming();
    await finishClaim({ organizationId: filed.organizationId, uploadId: filed.id });
    expect((await row(filed))!.purgeAfter).toBeNull();
    await set(filed, { purgeAfter: ago(MINUTE) });
    // Rows whose key was changed: another organization's file, and this organization's own older file.
    const legacyB = `org/${fx.orgB.organizationId}/solicitation/${randomUUID()}/RFP.pdf`;
    const legacyA = `org/${fx.orgA.organizationId}/solicitation/${randomUUID()}/RFP.pdf`;
    const tampered = [await stored(), await stored()];
    for (const [i, key] of [legacyB, legacyA].entries()) {
      await storage().put({ key, bytes: TEXT, contentType: "text/plain" });
      await set(tampered[i]!, { status: "failed", storageKey: key, purgeAfter: ago(MINUTE) });
    }
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);

    await sweepUploads();
    expect(await row(cancelled)).toMatchObject({ purgedAt: expect.any(Date) });
    expect(await kept(cancelled.key)).toBe(false);
    expect(await row(chat)).toMatchObject({ status: "claimed", purgedAt: expect.any(Date) });
    expect(await kept(chat.key)).toBe(false);
    expect(await row(filed)).toMatchObject({ status: "claimed", purgedAt: null });
    expect(await kept(filed.key)).toBe(true);
    for (const [i, key] of [legacyB, legacyA].entries()) {
      expect(await kept(key)).toBe(true);
      expect(await row(tampered[i]!)).toMatchObject({ purgeAfter: null, purgedAt: null });
    }
    expect(error.mock.calls.filter((c) => /not the one built for it/.test(String(c[1])))).toHaveLength(2);
  });

  it("retries a delete that failed later, and prunes rows 90 days after their object", async () => {
    const failing = await stored();
    await set(failing, { purgeAfter: ago(MINUTE) });
    vi.spyOn(storage(), "delete").mockRejectedValueOnce(new Error("R2 delete failed (503)"));
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await sweepUploads();
    const after = await row(failing);
    expect(after).toMatchObject({ status: "failed", purgeAttempts: 1, purgedAt: null });
    expect(after!.purgeAfter!.getTime()).toBeGreaterThan(Date.now());
    expect(await kept(failing.key)).toBe(true);

    const old = await stored();
    await set(old, { status: "failed", purgedAt: ago(91 * 24 * 60 * MINUTE), purgeAfter: ago(92 * 24 * 60 * MINUTE) });
    const recent = await stored();
    await set(recent, { status: "failed", purgedAt: ago(89 * 24 * 60 * MINUTE), purgeAfter: ago(90 * 24 * 60 * MINUTE) });
    const sweep = await sweepUploads();
    expect(sweep.pruned).toBeGreaterThanOrEqual(1);
    expect(await row(old)).toBeUndefined();
    expect(await row(recent)).toBeDefined();
  });

  it("stops at its row cap and says more is due", async () => {
    for (let i = 0; i < 2; i++) await set(await arrived(), { purgeAfter: ago(MINUTE) });
    expect(await sweepUploads({ limit: 1 })).toMatchObject({ expired: 1, deferred: true });
    await sweepUploads();
  });
});
