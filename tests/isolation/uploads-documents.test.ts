/**
 * BL-STAB-2d — a companion document from an upload straight to storage:
 * the checked upload is filed once under its solicitation with its type,
 * its parse reads the file from storage, another organization's
 * solicitation is refused before the claim (the upload stays usable), and
 * Reparse tells storage that can't be reached from a file that is gone.
 * Postgres; memory storage stands in for R2; background work is run by
 * hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, fileUploads, solicitationDocuments, solicitations } from "@/db/schema";
import { executeJob } from "@/lib/jobs";
import { getStorageProvider } from "@/lib/storage";
import { completeUpload, createUploadIntent } from "@/lib/uploads";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@documents.test",
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

import { addSolicitationDocumentFromUploadAction, reparseSolicitationDocumentAction } from "@/app/(app)/solicitations/[id]/document-actions";

const PWS = new TextEncoder().encode(
  [
    "PERFORMANCE WORK STATEMENT — Help Desk Support",
    "3.1 The contractor shall staff the help desk from 7 a.m. to 7 p.m. Eastern on business days.",
    "3.2 The contractor shall resolve priority-one tickets within four hours.",
  ].join("\n"),
);

describe("BL-STAB-2d — companion documents from direct uploads (runtime)", () => {
  let fx: TwoTenantFixture;
  const actorA = () => ({ userId: fx.orgA.userId, email: null });

  beforeEach(async () => {
    fx = await createTwoTenants("uploads-docs");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  async function solicitationFor(organizationId: string) {
    const [row] = await db
      .insert(solicitations)
      .values({ organizationId, title: "Help desk RFP", parseStatus: "parsed", rawText: "RFP" })
      .returning({ id: solicitations.id });
    return row!.id;
  }

  async function storedUpload(name = "PWS.txt", bytes = PWS) {
    const intent = await createUploadIntent({ organizationId: fx.orgA.organizationId, actor: actorA(), purpose: "document", fileName: name, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return { uploadId: intent.uploadId, key: row!.storageKey };
  }

  it("files a checked upload once as a typed companion document and parses it from storage", async () => {
    const solicitationId = await solicitationFor(fx.orgA.organizationId);
    const { uploadId, key } = await storedUpload();
    const res = await addSolicitationDocumentFromUploadAction(solicitationId, { uploadId, documentType: "pws" });
    if (!res.ok) throw new Error(res.error);
    // A retry (a lost answer) returns the same document instead of a second one.
    expect(await addSolicitationDocumentFromUploadAction(solicitationId, { uploadId, documentType: "pws" })).toEqual({ ok: true, id: res.id });

    const docs = await db.select().from(solicitationDocuments).where(and(eq(solicitationDocuments.organizationId, fx.orgA.organizationId), eq(solicitationDocuments.solicitationId, solicitationId)));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: res.id, documentType: "pws", storagePath: key, fileName: "PWS.txt", fileSize: PWS.byteLength });

    const [job] = await db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), eq(backgroundJobs.resourceId, res.id)));
    expect(job).toMatchObject({ kind: "solicitation_document_parse" });
    await executeJob(job!.id, fx.orgA.organizationId, { viaCron: true });
    const [parsed] = await db.select().from(solicitationDocuments).where(and(eq(solicitationDocuments.organizationId, fx.orgA.organizationId), eq(solicitationDocuments.id, res.id)));
    expect(parsed!.parseStatus).not.toBe("failed");
  });

  it("an unknown type is filed as other", async () => {
    const solicitationId = await solicitationFor(fx.orgA.organizationId);
    const { uploadId } = await storedUpload("notes.txt");
    const res = await addSolicitationDocumentFromUploadAction(solicitationId, { uploadId, documentType: "<script>" });
    if (!res.ok) throw new Error(res.error);
    const [doc] = await db.select().from(solicitationDocuments).where(and(eq(solicitationDocuments.organizationId, fx.orgA.organizationId), eq(solicitationDocuments.id, res.id)));
    expect(doc!.documentType).toBe("other");
  });

  it("refuses another organization's solicitation before the claim, leaving the upload usable", async () => {
    const foreign = await solicitationFor(fx.orgB.organizationId);
    const own = await solicitationFor(fx.orgA.organizationId);
    const { uploadId } = await storedUpload();
    expect(await addSolicitationDocumentFromUploadAction(foreign, { uploadId, documentType: "pws" })).toEqual({ ok: false, error: "Solicitation not found." });
    const res = await addSolicitationDocumentFromUploadAction(own, { uploadId, documentType: "pws" });
    expect(res.ok).toBe(true);
  });

  it("Reparse checks the stored file without downloading it, and tells unreachable from gone", async () => {
    const solicitationId = await solicitationFor(fx.orgA.organizationId);
    const { uploadId } = await storedUpload();
    const res = await addSolicitationDocumentFromUploadAction(solicitationId, { uploadId, documentType: "sow" });
    if (!res.ok) throw new Error(res.error);
    const head = vi.spyOn(getStorageProvider(), "head").mockRejectedValueOnce(new Error("timed out"));
    expect(await reparseSolicitationDocumentAction(res.id)).toEqual({ ok: false, error: "File storage could not be reached just now. Try Reparse again in a minute." });
    head.mockResolvedValueOnce(null);
    // Memory storage stands in for R2 here, so the message names it.
    expect(await reparseSolicitationDocumentAction(res.id)).toEqual({ ok: false, error: "File bytes are no longer in storage — re-upload the document. (Memory storage doesn't survive redeploys.)" });
    head.mockRestore();
    expect(await reparseSolicitationDocumentAction(res.id)).toEqual({ ok: true });
  });
});
