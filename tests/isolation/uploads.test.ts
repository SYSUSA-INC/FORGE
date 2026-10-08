/**
 * BL-STAB-2b — the upload ledger against Postgres, with the in-memory
 * storage fallback standing in for R2: intent → (PUT) → complete → claim,
 * the refusals at each step, and that no other organization or user can
 * see, complete, claim or cancel an upload.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, fileUploads } from "@/db/schema";
import { getStorageProvider } from "@/lib/storage";
import {
  cancelUpload,
  claimUpload,
  completeUpload,
  createUploadIntent,
  finishClaim,
  getReservedUploadBytes,
  peekStoredUploads,
  releaseClaim,
} from "@/lib/uploads";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

describe("BL-STAB-2b — upload ledger (runtime)", () => {
  let fx: TwoTenantFixture;
  const actorA = () => ({ userId: fx.orgA.userId, email: null });

  beforeEach(async () => {
    fx = await createTwoTenants("uploads");
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  async function intent(fileName = "RFP.pdf", size = PDF.byteLength) {
    const res = await createUploadIntent({ organizationId: fx.orgA.organizationId, actor: actorA(), purpose: "document", fileName, size, origin: "https://www.sysgov.com" });
    if (!res.ok) throw new Error(res.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, res.uploadId)));
    return { res, row: row! };
  }

  async function storedUpload() {
    const { res, row } = await intent();
    await getStorageProvider().put({ key: row.storageKey, bytes: PDF, contentType: row.contentType });
    const done = await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: res.uploadId });
    if (!done.ok) throw new Error(done.error);
    return res.uploadId;
  }

  it("records an intent under a server-built key, through the app in memory mode, and audits it", async () => {
    const { res, row } = await intent("../Final RFP.pdf");
    expect(row.storageKey).toBe(`org/${fx.orgA.organizationId}/uploads/${res.uploadId}`);
    expect(row).toMatchObject({ status: "pending", purpose: "document", fileName: "-Final RFP.pdf", contentType: "application/pdf", declaredSize: PDF.byteLength, origin: "https://www.sysgov.com" });
    expect(res.transport).toBe("proxy");
    expect(res.put.url).toBe(`/api/uploads/${res.uploadId}`);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "file_upload.intent")));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain("RFP");
  });

  it("refuses older Office formats and files over the limit before any row exists", async () => {
    const legacy = await createUploadIntent({ organizationId: fx.orgA.organizationId, actor: actorA(), purpose: "document", fileName: "old.doc", size: 10, origin: "" });
    expect(legacy).toMatchObject({ ok: false, code: "legacy_office" });
    const huge = await createUploadIntent({ organizationId: fx.orgA.organizationId, actor: actorA(), purpose: "document", fileName: "big.pdf", size: 2 * 1024 ** 3, origin: "" });
    expect(huge).toMatchObject({ ok: false, code: "too_large" });
    expect(await db.select().from(fileUploads).where(eq(fileUploads.organizationId, fx.orgA.organizationId))).toHaveLength(0);
  });

  it("completes only what arrived whole and of the declared kind", async () => {
    const { res, row } = await intent();
    const early = await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: res.uploadId });
    expect(early).toMatchObject({ ok: false, code: "not_uploaded_yet", retryable: true });

    await getStorageProvider().put({ key: row.storageKey, bytes: PDF, contentType: row.contentType });
    const done = await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: res.uploadId });
    expect(done).toMatchObject({ ok: true, upload: { status: "stored", size: PDF.byteLength, format: "pdf" } });
    // Calling again is safe.
    expect(await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: res.uploadId })).toMatchObject({ ok: true });

    const short = await intent("short.pdf", PDF.byteLength + 1);
    await getStorageProvider().put({ key: short.row.storageKey, bytes: PDF, contentType: short.row.contentType });
    const shortDone = await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: short.res.uploadId });
    expect(shortDone).toMatchObject({ ok: false, code: "rejected" });
    expect(await getStorageProvider().head(short.row.storageKey)).toBeNull();

    const html = new TextEncoder().encode("<!DOCTYPE html><html><script>x</script></html>");
    const fake = await intent("notes.pdf", html.byteLength);
    await getStorageProvider().put({ key: fake.row.storageKey, bytes: html, contentType: fake.row.contentType });
    const fakeDone = await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: fake.res.uploadId });
    expect(fakeDone).toMatchObject({ ok: false, code: "rejected" });
    const [fakeRow] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, fake.res.uploadId)));
    expect(fakeRow).toMatchObject({ status: "failed", failureReason: "type_mismatch" });
    const rejects = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "file_upload.reject")));
    expect(rejects).toHaveLength(2);
  });

  it("is invisible to another organization and to another user", async () => {
    const uploadId = await storedUpload();
    const otherOrg = await completeUpload({ organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId, email: null }, uploadId });
    expect(otherOrg).toMatchObject({ ok: false, code: "not_found" });
    const otherUser = await completeUpload({ organizationId: fx.orgA.organizationId, actor: { userId: fx.orgB.userId, email: null }, uploadId });
    expect(otherUser).toMatchObject({ ok: false, code: "not_found" });
    expect(await claimUpload({ organizationId: fx.orgB.organizationId, userId: fx.orgB.userId, uploadId, resourceType: "solicitation" })).toMatchObject({ ok: false });
    await cancelUpload({ organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId, email: null }, uploadId });
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, uploadId)));
    expect(row!.status).toBe("stored");
  });

  it("claims once, keeps the record id across a released claim, and answers a repeat as already done", async () => {
    const uploadId = await storedUpload();
    expect(await claimUpload({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, uploadId, resourceType: "proposal_template" })).toMatchObject({
      ok: false,
      error: "This file was uploaded for something else.",
    });

    const [a, b] = await Promise.all([
      claimUpload({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, uploadId, resourceType: "solicitation" }),
      claimUpload({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, uploadId, resourceType: "solicitation" }),
    ]);
    const winners = [a, b].filter((r) => r.ok && "claim" in r);
    expect(winners).toHaveLength(1);
    const first = winners[0] as { claim: { resourceId: string; storageKey: string } };

    await releaseClaim({ organizationId: fx.orgA.organizationId, uploadId });
    const again = await claimUpload({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, uploadId, resourceType: "solicitation" });
    expect(again).toMatchObject({ ok: true, rerun: true, claim: { resourceId: first.claim.resourceId } });

    await finishClaim({ organizationId: fx.orgA.organizationId, uploadId });
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, uploadId)));
    expect(row).toMatchObject({ status: "claimed", purgeAfter: null, resourceType: "solicitation" });
    expect(await getStorageProvider().head(first.claim.storageKey)).not.toBeNull();
    expect(await claimUpload({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, uploadId, resourceType: "solicitation" })).toEqual({
      ok: true,
      alreadyClaimed: true,
      resourceId: first.claim.resourceId,
    });
  });

  it("checks a batch before anything is created, cancels cleanly, and counts reserved bytes", async () => {
    const good = await storedUpload();
    const pending = await intent("later.pdf");
    const peek = await peekStoredUploads({
      organizationId: fx.orgA.organizationId,
      userId: fx.orgA.userId,
      uploadIds: [good, pending.res.uploadId, "not-a-uuid"],
      resourceType: "solicitation",
    });
    expect(peek.ready.map((r) => r.uploadId)).toEqual([good]);
    expect(peek.bad.map((b) => b.uploadId)).toEqual([pending.res.uploadId, "not-a-uuid"]);

    expect(await getReservedUploadBytes(fx.orgA.organizationId)).toBe(2 * PDF.byteLength);
    expect(await getReservedUploadBytes(fx.orgB.organizationId)).toBe(0);

    await getStorageProvider().put({ key: pending.row.storageKey, bytes: PDF, contentType: pending.row.contentType });
    await cancelUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: pending.res.uploadId });
    const [cancelled] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, pending.res.uploadId)));
    expect(cancelled).toMatchObject({ status: "failed", failureReason: "cancelled" });
    expect(await getStorageProvider().head(pending.row.storageKey)).toBeNull();
    expect(await getReservedUploadBytes(fx.orgA.organizationId)).toBe(PDF.byteLength);
  });
});
