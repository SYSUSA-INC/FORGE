/**
 * BL-STAB-2f — chat attachments upload straight to storage (Postgres;
 * memory storage stands in for R2): the attach action files the upload,
 * keeps only the text and deletes the file at once; a retry returns the
 * same attachment; a refusal about the conversation leaves the upload
 * for a retry while a file that can't be read is failed and deleted; the
 * read budget is checked before any download; another tenant's section
 * or another person's upload is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, fileUploads, knowledgeArtifacts, proposalSections, sectionChatAttachments } from "@/db/schema";
import { getStorageProvider } from "@/lib/storage";
import { attachChatDocument, saveChatAttachmentToKnowledge } from "@/lib/section-chat-attachments";
import { getStorageBytesUsed } from "@/lib/subscription-gates";
import { claimUpload, completeUpload, createUploadIntent } from "@/lib/uploads";
import type { UploadPurpose } from "@/lib/upload-policy";
import { createTwoTenants, type TwoTenantFixture, withUploadPlans } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "writer@chat.test",
  name: "Volume Lead",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "member" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  getSessionUser: async () => sessionUserStub,
}));

import { attachChatDocumentAction } from "@/app/(app)/proposals/[id]/sections/ai/chat-actions";

const enc = new TextEncoder();
const SOW = enc.encode("1. Scope. The contractor shall migrate workloads.\n2. Deliverables. Monthly status reports.");

describe("BL-STAB-2f — chat attachments from direct uploads (runtime)", () => {
  let fx: TwoTenantFixture;
  let plans: (() => Promise<void>) | null = null;
  let sectionA = "";
  let sectionB = "";
  const org = () => fx.orgA.organizationId;

  beforeEach(async () => {
    fx = await createTwoTenants("chat-uploads");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    plans = await withUploadPlans(fx);
    const [a] = await db.insert(proposalSections).values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach" }).returning({ id: proposalSections.id });
    const [b] = await db.insert(proposalSections).values({ proposalId: fx.orgB.proposalId, kind: "technical", title: "Technical approach" }).returning({ id: proposalSections.id });
    sectionA = a!.id;
    sectionB = b!.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.UPLOAD_PARSE_SCALE;
    await plans?.();
    await fx.cleanup();
  });

  async function storedUpload(name = "sample-sow.txt", bytes = SOW, opts: { purpose?: UploadPurpose; userId?: string; organizationId?: string } = {}) {
    const actor = { userId: opts.userId ?? fx.orgA.userId, email: null };
    const organizationId = opts.organizationId ?? org();
    const intent = await createUploadIntent({ organizationId, actor, purpose: opts.purpose ?? "chat_attachment", fileName: name, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId, actor, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return { uploadId: intent.uploadId, key: row!.storageKey };
  }
  const ledger = async (uploadId: string) =>
    (await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, uploadId))))[0]!;
  const rowsIn = (sectionId: string) =>
    db.select().from(sectionChatAttachments).where(and(eq(sectionChatAttachments.organizationId, org()), eq(sectionChatAttachments.sectionId, sectionId)));
  const attachAudits = () =>
    db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, org()), eq(auditLogs.action, "section_chat.attach")));

  it("files the upload, keeps only the text and deletes the file; a retry returns the same attachment", async () => {
    const { uploadId, key } = await storedUpload();
    const res = await attachChatDocumentAction({ sectionId: sectionA, uploadId });
    if (!res.ok) throw new Error(res.error);
    expect(res.attachment).toMatchObject({ fileName: "sample-sow.txt", contentType: "text/plain", fileSize: SOW.byteLength });

    const [row] = await rowsIn(sectionA);
    expect(row).toMatchObject({ id: res.attachment.id, text: expect.stringContaining("Monthly status reports") });
    expect(await getStorageProvider().head(key)).toBeNull();
    const up = await ledger(uploadId);
    expect(up).toMatchObject({ status: "claimed", resourceType: "section_chat_attachment", resourceId: res.attachment.id });
    // A second delete once the upload link can no longer write the key.
    expect(up.purgeAfter!.getTime()).toBe(up.urlExpiresAt.getTime() + 5 * 60_000);
    const [audit] = await attachAudits();
    expect(audit!.metadata).toMatchObject({ attachmentId: res.attachment.id, uploadId });

    // The answer was lost and the browser asks again.
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId })).toEqual(res);
    expect(await rowsIn(sectionA)).toHaveLength(1);
    expect(await attachAudits()).toHaveLength(1);
    // The same upload named for another section's conversation is not shown there.
    const [other] = await db.insert(proposalSections).values({ proposalId: fx.orgA.proposalId, kind: "management", title: "Management" }).returning({ id: proposalSections.id });
    expect(await attachChatDocumentAction({ sectionId: other!.id, uploadId })).toMatchObject({ ok: false, error: expect.stringMatching(/not in this conversation/) });
    // Removed since: asking again doesn't bring it back.
    await db.delete(sectionChatAttachments).where(and(eq(sectionChatAttachments.organizationId, org()), eq(sectionChatAttachments.id, res.attachment.id)));
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId })).toMatchObject({ ok: false, error: expect.stringMatching(/not in this conversation/) });
  });

  it("Save to Knowledge counts the text it keeps, not the file it was read from", async () => {
    const { uploadId } = await storedUpload("padded.txt", enc.encode(`Scope of work.\n${" ".repeat(20_000)}\n`));
    const res = await attachChatDocumentAction({ sectionId: sectionA, uploadId });
    if (!res.ok) throw new Error(res.error);
    expect(res.attachment.fileSize).toBeGreaterThan(20_000);
    const before = await getStorageBytesUsed(org());
    const saved = await saveChatAttachmentToKnowledge({ organizationId: org(), attachmentId: res.attachment.id, actor: { userId: fx.orgA.userId } });
    if (!saved.ok) throw new Error(saved.error);
    const [artifact] = await db.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.organizationId, org()), eq(knowledgeArtifacts.id, saved.artifactId)));
    expect(artifact).toMatchObject({ rawText: "Scope of work.", fileSize: "Scope of work.".length, storagePath: "" });
    expect(await getStorageBytesUsed(org())).toBe(before + "Scope of work.".length);
  });

  it("reads a .csv as text", async () => {
    const { uploadId } = await storedUpload("rates.csv", enc.encode("Labor category,Rate\nSenior engineer,185\n"));
    const res = await attachChatDocumentAction({ sectionId: sectionA, uploadId });
    if (!res.ok) throw new Error(res.error);
    expect(res.attachment.contentType).toBe("text/plain");
    expect((await rowsIn(sectionA))[0]!.text).toContain("Senior engineer,185");
  });

  it("refuses another tenant's section, another purpose and another person's upload, keeping the file", async () => {
    const { uploadId, key } = await storedUpload();
    expect(await attachChatDocumentAction({ sectionId: sectionB, uploadId })).toEqual({ ok: false, error: "Section not found." });
    expect(await attachChatDocumentAction({ sectionId: "not-a-uuid", uploadId })).toEqual({ ok: false, error: "Section not found." });
    expect(await ledger(uploadId)).toMatchObject({ status: "stored", resourceId: null });
    expect(await getStorageProvider().head(key)).not.toBeNull();

    const doc = await storedUpload("sow.txt", SOW, { purpose: "document" });
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId: doc.uploadId })).toEqual({ ok: false, error: "This file was uploaded for something else." });
    // Someone else's upload here, and this person's own upload in another organization.
    const theirs = await storedUpload("sow.txt", SOW, { userId: fx.orgB.userId });
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId: theirs.uploadId })).toEqual({ ok: false, error: "Upload not found." });
    const elsewhere = await storedUpload("sow.txt", SOW, { organizationId: fx.orgB.organizationId });
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId: elsewhere.uploadId })).toEqual({ ok: false, error: "Upload not found." });
    expect(await rowsIn(sectionA)).toHaveLength(0);
  });

  it("at five documents the upload is put back for a retry, not failed", async () => {
    const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
    for (const [i, id] of ids.entries()) {
      const res = await attachChatDocument({ organizationId: org(), sectionId: sectionA, id, fileName: `n${i}.txt`, contentType: "text/plain", bytes: SOW, actor: { userId: fx.orgA.userId } });
      if (!res.ok) throw new Error(res.error);
    }
    // Saving the fifth again is a retry, not a sixth.
    const again = await attachChatDocument({ organizationId: org(), sectionId: sectionA, id: ids[4], fileName: "n4.txt", contentType: "text/plain", bytes: SOW, actor: { userId: fx.orgA.userId } });
    expect(again).toMatchObject({ ok: true, attachment: { id: ids[4] } });
    expect(await attachAudits()).toHaveLength(5);
    const { uploadId, key } = await storedUpload();
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId })).toEqual({ ok: false, error: "Up to 5 documents per conversation; remove one first." });
    expect(await ledger(uploadId)).toMatchObject({ status: "stored" });
    expect(await getStorageProvider().head(key)).not.toBeNull();
    expect(await rowsIn(sectionA)).toHaveLength(5);
  });

  it("a file with no readable text is failed and deleted", async () => {
    const { uploadId, key } = await storedUpload("blank.txt", enc.encode(" \n\t \n"));
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId })).toEqual({ ok: false, error: "No readable text in this file." });
    expect(await ledger(uploadId)).toMatchObject({ status: "failed", failureReason: "claim_failed", failureDetail: "No readable text in this file." });
    expect(await getStorageProvider().head(key)).toBeNull();
    expect(await rowsIn(sectionA)).toHaveLength(0);
  });

  it("a file over the read budget is refused before it is downloaded", async () => {
    const { uploadId, key } = await storedUpload();
    process.env.UPLOAD_PARSE_SCALE = "0.25";
    await db.update(fileUploads).set({ storedSize: 7 * 1024 * 1024 }).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, uploadId)));
    const get = vi.spyOn(getStorageProvider(), "get");
    const res = await attachChatDocumentAction({ sectionId: sectionA, uploadId });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/is 7 MB; the chat reads files of this type up to 6 MB/) });
    expect(get).not.toHaveBeenCalled();
    expect(await ledger(uploadId)).toMatchObject({ status: "failed", failureReason: "claim_failed" });
    expect(await getStorageProvider().head(key)).toBeNull();
  });

  it("a file swapped after its check is refused; storage that can't be reached keeps the upload", async () => {
    const swapped = await storedUpload();
    await getStorageProvider().put({ key: swapped.key, bytes: enc.encode("x".repeat(SOW.byteLength)), contentType: "text/plain" });
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId: swapped.uploadId })).toEqual({
      ok: false,
      error: "The stored file changed after it was uploaded; attach it again.",
    });
    expect(await ledger(swapped.uploadId)).toMatchObject({ status: "failed" });

    const { uploadId } = await storedUpload();
    vi.spyOn(getStorageProvider(), "head").mockRejectedValueOnce(new Error("timed out"));
    expect(await attachChatDocumentAction({ sectionId: sectionA, uploadId })).toEqual({
      ok: false,
      error: "File storage could not be reached just now. Try again in a minute.",
    });
    expect(await ledger(uploadId)).toMatchObject({ status: "stored" });
    const res = await attachChatDocumentAction({ sectionId: sectionA, uploadId });
    expect(res.ok).toBe(true);
  });

  it("an attempt that died after saving is finished by the retry without a second row", async () => {
    const { uploadId, key } = await storedUpload();
    const claim = await claimUpload({ organizationId: org(), userId: fx.orgA.userId, uploadId, resourceType: "section_chat_attachment" });
    if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
    const saved = await attachChatDocument({ organizationId: org(), sectionId: sectionA, id: claim.claim.resourceId, uploadId, fileName: "sample-sow.txt", contentType: "text/plain", bytes: SOW, actor: { userId: fx.orgA.userId } });
    if (!saved.ok) throw new Error(saved.error);
    await db.update(fileUploads).set({ claimedAt: new Date(Date.now() - 3 * 60_000) }).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, uploadId)));
    const get = vi.spyOn(getStorageProvider(), "get");

    const res = await attachChatDocumentAction({ sectionId: sectionA, uploadId });
    expect(res).toEqual({ ok: true, attachment: saved.attachment });
    expect(get).not.toHaveBeenCalled();
    expect(await rowsIn(sectionA)).toHaveLength(1);
    expect(await attachAudits()).toHaveLength(1);
    expect(await ledger(uploadId)).toMatchObject({ status: "claimed" });
    expect(await getStorageProvider().head(key)).toBeNull();
  });
});
