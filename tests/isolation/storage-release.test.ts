/**
 * BL-STAB-2f — deleted records leave storage (Postgres; memory storage
 * stands in for R2): a deleted solicitation releases its own file, its
 * amendments' (to any depth) and its companion documents'; a deleted
 * document or knowledge file releases its file; the jobs cron's sweep then
 * deletes released files, but never one a record still holds; a file
 * stored before the upload ledger is deleted at once unless another record
 * names it; another organization's files are untouched.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, fileUploads, knowledgeArtifacts, solicitationDocuments, solicitations } from "@/db/schema";
import { getStorageProvider } from "@/lib/storage";
import { claimUpload, completeUpload, createUploadIntent, finishClaim, releaseStoredFile, sweepUploads } from "@/lib/uploads";
import { createTwoTenants, type TwoTenantFixture, withUploadPlans } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@release.test",
  name: "Capture Lead",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  requireOrgAdmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));
vi.mock("@/lib/background", () => ({ runInBackground: () => undefined, backgroundIsDurable: () => false }));

import { deleteKnowledgeArtifactAction } from "@/app/(app)/knowledge-base/import/actions";
import { deleteSolicitationDocumentAction } from "@/app/(app)/solicitations/[id]/document-actions";
import { deleteSolicitationAction } from "@/app/(app)/solicitations/actions";

const TEXT = new TextEncoder().encode("Section C. The contractor shall staff the help desk.\n");

describe("BL-STAB-2f — deleted records leave storage (runtime)", () => {
  let fx: TwoTenantFixture;
  let plans: (() => Promise<void>) | null = null;
  const storage = () => getStorageProvider();
  const kept = async (key: string) => (await storage().head(key)) !== null;

  beforeEach(async () => {
    fx = await createTwoTenants("storage-release");
    plans = await withUploadPlans(fx);
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await plans?.();
    await fx.cleanup();
  });

  /** A checked upload filed as `resourceType`, as the upload actions file it. */
  async function filed(resourceType: "solicitation" | "solicitation_document" | "knowledge_artifact", which: "A" | "B" = "A") {
    const { organizationId, userId } = which === "A" ? fx.orgA : fx.orgB;
    const intent = await createUploadIntent({ organizationId, actor: { userId, email: null }, purpose: "document", fileName: "f.txt", size: TEXT.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, organizationId), eq(fileUploads.id, intent.uploadId)));
    await storage().put({ key: row!.storageKey, bytes: TEXT, contentType: row!.contentType });
    const done = await completeUpload({ organizationId, actor: { userId, email: null }, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    const claim = await claimUpload({ organizationId, userId, uploadId: intent.uploadId, resourceType });
    if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
    return { uploadId: intent.uploadId, key: row!.storageKey, id: claim.claim.resourceId, claimedAt: claim.claim.claimedAt, organizationId };
  }
  const finish = (f: { organizationId: string; uploadId: string; claimedAt: Date }) => finishClaim(f);
  const ledger = async (ids: string[]) =>
    Object.fromEntries((await db.select().from(fileUploads).where(inArray(fileUploads.id, ids))).map((r) => [r.id, [r.status, r.failureReason]]));

  it("a deleted solicitation releases its file, its amendments' to any depth and its documents'; the sweep deletes them", async () => {
    const org = fx.orgA.organizationId;
    const root = await filed("solicitation");
    await db.insert(solicitations).values({ id: root.id, organizationId: org, title: "RFP", fileName: "RFP.txt", storagePath: root.key, parseStatus: "parsed" });
    await finish(root);
    const amendment = await filed("solicitation");
    await db.insert(solicitations).values({ id: amendment.id, organizationId: org, title: "A1", storagePath: amendment.key, parseStatus: "parsed", parentSolicitationId: root.id });
    await finish(amendment);
    const nested = await filed("solicitation");
    await db.insert(solicitations).values({ id: nested.id, organizationId: org, title: "A1.1", storagePath: nested.key, parseStatus: "parsed", parentSolicitationId: amendment.id });
    await finish(nested);
    const doc = await filed("solicitation_document");
    await db.insert(solicitationDocuments).values({ id: doc.id, organizationId: org, solicitationId: nested.id, documentType: "pws", fileName: "PWS.txt", storagePath: doc.key, parseStatus: "parsed" });
    await finish(doc);
    // An amendment stored before the upload ledger: its file is deleted at once.
    const legacyKey = `org/${org}/solicitation/${randomUUID()}/Old amendment.pdf`;
    await storage().put({ key: legacyKey, bytes: TEXT, contentType: "application/pdf" });
    await db.insert(solicitations).values({ organizationId: org, title: "Old", storagePath: legacyKey, parseStatus: "parsed", parentSolicitationId: root.id });
    // Another organization's filed solicitation.
    const theirs = await filed("solicitation", "B");
    await db.insert(solicitations).values({ id: theirs.id, organizationId: fx.orgB.organizationId, title: "Theirs", storagePath: theirs.key, parseStatus: "parsed" });
    await finish(theirs);

    expect(await deleteSolicitationAction(randomUUID())).toEqual({ ok: false, error: "Solicitation not found." });
    expect(await deleteSolicitationAction(theirs.id)).toEqual({ ok: false, error: "Solicitation not found." });
    expect(await deleteSolicitationAction(root.id)).toEqual({ ok: true });

    expect(await db.select().from(solicitations).where(eq(solicitations.organizationId, org))).toEqual([]);
    expect(await ledger([root.uploadId, amendment.uploadId, nested.uploadId, doc.uploadId, theirs.uploadId])).toEqual({
      [root.uploadId]: ["released", "deleted"],
      [amendment.uploadId]: ["released", "deleted"],
      [nested.uploadId]: ["released", "deleted"],
      [doc.uploadId]: ["released", "deleted"],
      [theirs.uploadId]: ["claimed", ""],
    });
    expect(await kept(legacyKey)).toBe(false);
    const [audit] = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org), eq(auditLogs.action, "solicitation.delete"), eq(auditLogs.resourceId, root.id)));
    expect(audit?.metadata).toMatchObject({ fileName: "RFP.txt", amendments: 3, documents: 1, filesReleased: 5 });

    // The jobs cron's sweep deletes the released files, not the other organization's.
    await sweepUploads();
    for (const f of [root, amendment, nested, doc]) expect(await kept(f.key)).toBe(false);
    expect(await kept(theirs.key)).toBe(true);
    // A released upload can't be filed again.
    expect(await claimUpload({ organizationId: org, userId: fx.orgA.userId, uploadId: root.uploadId, resourceType: "solicitation" })).toEqual({
      ok: false,
      error: "This file was removed with the record it was saved on. Upload it again.",
    });
  });

  it("a deleted document or knowledge file releases its file; a missing one changes nothing", async () => {
    const org = fx.orgA.organizationId;
    const [parent] = await db.insert(solicitations).values({ organizationId: org, title: "RFP", parseStatus: "parsed" }).returning({ id: solicitations.id });
    const doc = await filed("solicitation_document");
    await db.insert(solicitationDocuments).values({ id: doc.id, organizationId: org, solicitationId: parent!.id, documentType: "pws", fileName: "PWS.txt", storagePath: doc.key, parseStatus: "parsed" });
    await finish(doc);
    const art = await filed("knowledge_artifact");
    await db.insert(knowledgeArtifacts).values({ id: art.id, organizationId: org, kind: "note", source: "uploaded", title: "n", fileName: "n.txt", storagePath: art.key, status: "indexed" });
    await finish(art);

    expect(await deleteSolicitationDocumentAction(doc.id)).toEqual({ ok: true });
    expect(await deleteKnowledgeArtifactAction(art.id)).toEqual({ ok: true });
    expect(await deleteKnowledgeArtifactAction(art.id)).toEqual({ ok: false, error: "Artifact not found." });
    expect(await ledger([doc.uploadId, art.uploadId])).toEqual({ [doc.uploadId]: ["released", "deleted"], [art.uploadId]: ["released", "deleted"] });
    const audits = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org), inArray(auditLogs.resourceId, [doc.id, art.id])));
    expect(audits.filter((a) => a.action === "knowledge_artifact.delete")).toEqual([{ action: "knowledge_artifact.delete", metadata: { fileReleased: true } }]);
    expect(audits.find((a) => a.action === "solicitation.document.delete")?.metadata).toMatchObject({ fileReleased: true });
  });

  it("a filing that finishes after its record was deleted, or a file a delete's own list missed, is still released", async () => {
    const org = fx.orgA.organizationId;
    const [parent] = await db.insert(solicitations).values({ organizationId: org, title: "RFP", parseStatus: "parsed" }).returning({ id: solicitations.id });
    // The document is saved, then deleted while its filing is still finishing.
    const late = await filed("solicitation_document");
    await db.insert(solicitationDocuments).values({ id: late.id, organizationId: org, solicitationId: parent!.id, documentType: "pws", fileName: "PWS.txt", storagePath: late.key, parseStatus: "parsed" });
    expect(await deleteSolicitationDocumentAction(late.id)).toEqual({ ok: true });
    expect(await ledger([late.uploadId])).toEqual({ [late.uploadId]: ["claiming", ""] });
    await finish(late);
    expect(await ledger([late.uploadId])).toEqual({ [late.uploadId]: ["released", "deleted"] });

    // A filed document whose record went without its file being released (a delete before
    // files were released, or one filed between a delete's look and the delete).
    const missed = await filed("solicitation_document");
    await db.insert(solicitationDocuments).values({ id: missed.id, organizationId: org, solicitationId: parent!.id, documentType: "pws", fileName: "SOW.txt", storagePath: missed.key, parseStatus: "parsed" });
    await finish(missed);
    await db.delete(solicitationDocuments).where(and(eq(solicitationDocuments.organizationId, org), eq(solicitationDocuments.id, missed.id)));
    // Another organization's orphan is not this delete's to release.
    const theirs = await filed("solicitation_document", "B");
    await db.update(fileUploads).set({ status: "claimed", purgeAfter: null }).where(and(eq(fileUploads.organizationId, fx.orgB.organizationId), eq(fileUploads.id, theirs.uploadId)));
    expect(await deleteSolicitationAction(parent!.id)).toEqual({ ok: true });
    expect(await ledger([missed.uploadId, theirs.uploadId])).toEqual({ [missed.uploadId]: ["released", "deleted"], [theirs.uploadId]: ["claimed", ""] });
  });

  it("never deletes a file a record still holds, another record names, or another organization owns", async () => {
    const org = fx.orgA.organizationId;
    // A release that raced a save: the record still holds the file, so the sweep keeps it.
    const held = await filed("solicitation");
    await db.insert(solicitations).values({ id: held.id, organizationId: org, title: "RFP", storagePath: held.key, parseStatus: "parsed" });
    await finish(held);
    expect(await releaseStoredFile({ organizationId: org, storagePath: held.key, reason: "deleted" })).toBe("released");
    vi.spyOn((await import("@/lib/log")).log, "error").mockImplementation(() => undefined);
    await sweepUploads();
    expect(await ledger([held.uploadId])).toEqual({ [held.uploadId]: ["claimed", ""] });
    expect(await kept(held.key)).toBe(true);

    // A pre-ledger file another record still names is left alone.
    const legacyKey = `org/${org}/knowledge/${randomUUID()}/shared.pdf`;
    await storage().put({ key: legacyKey, bytes: TEXT, contentType: "application/pdf" });
    await db.insert(knowledgeArtifacts).values({ organizationId: org, kind: "note", source: "uploaded", title: "n", fileName: "shared.pdf", storagePath: legacyKey, status: "indexed" });
    expect(await releaseStoredFile({ organizationId: org, storagePath: legacyKey, reason: "deleted" })).toBe("skipped");
    expect(await kept(legacyKey)).toBe(true);

    // Another organization's key is refused outright.
    const theirKey = `org/${fx.orgB.organizationId}/knowledge/${randomUUID()}/theirs.pdf`;
    await storage().put({ key: theirKey, bytes: TEXT, contentType: "application/pdf" });
    expect(await releaseStoredFile({ organizationId: org, storagePath: theirKey, reason: "deleted" })).toBe("skipped");
    expect(await kept(theirKey)).toBe(true);
    expect(await releaseStoredFile({ organizationId: org, storagePath: "", reason: "deleted" })).toBe("skipped");
  });
});
