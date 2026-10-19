/**
 * BL-STAB-2f — a Word template's .docx is uploaded straight to storage and
 * attached by its upload id (Postgres; memory storage stands in for R2):
 * the file is read back verified and scanned for placeholders; a replace
 * releases the old file but never the one just attached (a repeat, or a
 * retry whose save had landed); an upload filed for one template can't be
 * attached to another; a file that can't be read as a .docx is refused and
 * deleted; clearing the template releases its file.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, fileUploads, proposalTemplates } from "@/db/schema";
import { getStorageProvider } from "@/lib/storage";
import { claimUpload, completeUpload, createUploadIntent } from "@/lib/uploads";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";
import { officeZip } from "../helpers/zip-fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "admin@templates.test",
  name: "Template Admin",
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

import { attachTemplateDocxFromUploadAction, clearTemplateDocxAction, createTemplateAction } from "@/app/(app)/settings/templates/actions";

const docx = (body: string) => officeZip("docx", { omitMarker: true, extra: { "word/document.xml": `<w:document><w:body><w:t>${body}</w:t></w:body></w:document>` } });

describe("BL-STAB-2f — Word templates from direct uploads (runtime)", () => {
  let fx: TwoTenantFixture;
  let tier: { cleanup: () => Promise<void> };
  const org = () => fx.orgA.organizationId;
  const storage = () => getStorageProvider();
  const kept = async (key: string) => (await storage().head(key)) !== null;

  beforeEach(async () => {
    fx = await createTwoTenants("tpl-uploads");
    tier = await createTierAndSubscribe({ organizationId: org(), slug: `tu-${org().replace(/-/g, "").slice(0, 28)}`, name: "Templates", featureFlags: { customTemplates: true } });
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = org();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await tier.cleanup();
    await fx.cleanup();
  });

  async function uploaded(bytes: Uint8Array, name = "House style.docx") {
    const intent = await createUploadIntent({ organizationId: org(), actor: { userId: fx.orgA.userId, email: null }, purpose: "template_docx", fileName: name, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, intent.uploadId)));
    await storage().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId: org(), actor: { userId: fx.orgA.userId, email: null }, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return { uploadId: intent.uploadId, key: row!.storageKey };
  }
  const template = async (id: string) =>
    (await db.select().from(proposalTemplates).where(and(eq(proposalTemplates.organizationId, org()), eq(proposalTemplates.id, id))))[0]!;
  const status = async (uploadId: string) =>
    (await db.select({ status: fileUploads.status, failureReason: fileUploads.failureReason }).from(fileUploads).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, uploadId))))[0];
  async function newTemplate(name: string) {
    const made = await createTemplateAction({ name });
    if (!made.ok) throw new Error(made.error);
    return made.id;
  }

  it("attaches a checked upload, scans it, and on replace releases the old file but never the new one", async () => {
    const id = await newTemplate("House style");
    // A file stored before the upload ledger, under the template's old key.
    const legacyKey = `org/${org()}/template/${id}/Old style.docx`;
    await storage().put({ key: legacyKey, bytes: await docx("{oldVariable}"), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    await db.update(proposalTemplates).set({ kind: "docx", docxStoragePath: legacyKey, docxFileName: "Old style.docx" }).where(and(eq(proposalTemplates.organizationId, org()), eq(proposalTemplates.id, id)));

    const first = await uploaded(await docx("{organizationName} — {proposalTitle}"));
    const res = await attachTemplateDocxFromUploadAction(id, first.uploadId);
    expect(res).toMatchObject({ ok: true, variables: ["organizationName", "proposalTitle"], fileName: "House style.docx" });
    expect(await template(id)).toMatchObject({ kind: "docx", docxStoragePath: first.key, docxFileName: "House style.docx", variablesDetected: ["organizationName", "proposalTitle"] });
    expect(await status(first.uploadId)).toEqual({ status: "claimed", failureReason: "" });
    expect(await kept(legacyKey)).toBe(false);

    // A repeat answers with what the template holds and releases nothing.
    expect(await attachTemplateDocxFromUploadAction(id, first.uploadId)).toMatchObject({ ok: true, fileName: "House style.docx" });
    expect(await status(first.uploadId)).toEqual({ status: "claimed", failureReason: "" });

    // A replace releases the file it replaces.
    const second = await uploaded(await docx("{organizationName}"), "House style v2.docx");
    expect(await attachTemplateDocxFromUploadAction(id, second.uploadId)).toMatchObject({ ok: true, fileName: "House style v2.docx" });
    expect(await status(first.uploadId)).toEqual({ status: "released", failureReason: "replaced" });
    expect(await status(second.uploadId)).toEqual({ status: "claimed", failureReason: "" });
    const [audit] = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org()), eq(auditLogs.action, "template.upload_docx"), eq(auditLogs.resourceId, id)))
      .orderBy(auditLogs.createdAt);
    expect(audit?.metadata).toMatchObject({ uploadId: first.uploadId, replaced: true });

    // Clearing releases the attached file.
    expect(await clearTemplateDocxAction(id)).toEqual({ ok: true });
    expect(await template(id)).toMatchObject({ docxStoragePath: "", docxFileName: "" });
    expect(await status(second.uploadId)).toEqual({ status: "released", failureReason: "deleted" });
  });

  it("a retry whose save had landed finishes it without releasing its own file", async () => {
    const id = await newTemplate("Retry");
    const up = await uploaded(await docx("{organizationName}"));
    const claim = await claimUpload({ organizationId: org(), userId: fx.orgA.userId, uploadId: up.uploadId, resourceType: "proposal_template", resourceId: id });
    if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
    // The earlier attempt saved the template, then died before finishing the claim.
    await db.update(proposalTemplates).set({ kind: "docx", docxStoragePath: up.key }).where(and(eq(proposalTemplates.organizationId, org()), eq(proposalTemplates.id, id)));
    await db.update(fileUploads).set({ claimedAt: new Date(Date.now() - 3 * 60_000) }).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, up.uploadId)));
    expect(await attachTemplateDocxFromUploadAction(id, up.uploadId)).toMatchObject({ ok: true });
    expect(await status(up.uploadId)).toEqual({ status: "claimed", failureReason: "" });
    expect(await kept(up.key)).toBe(true);
  });

  it("leaves the upload ready to retry when another change to the template's file lands first", async () => {
    const id = await newTemplate("Two tabs");
    const up = await uploaded(await docx("{organizationName}"));
    const otherKey = `org/${org()}/uploads/${randomUUID()}`;
    // Another tab attaches its file between this request's read and its write.
    const realUpdate = db.update.bind(db);
    let raced = false;
    vi.spyOn(db, "update").mockImplementation(((table: Parameters<typeof db.update>[0]) => {
      if (table === proposalTemplates && !raced) {
        raced = true;
        return {
          set: (values: never) => ({
            where: (cond: never) => ({
              returning: async (cols: never) => {
                await realUpdate(proposalTemplates).set({ docxStoragePath: otherKey }).where(and(eq(proposalTemplates.organizationId, org()), eq(proposalTemplates.id, id)));
                return realUpdate(proposalTemplates).set(values).where(cond).returning(cols);
              },
            }),
          }),
        };
      }
      return realUpdate(table);
    }) as never);
    expect(await attachTemplateDocxFromUploadAction(id, up.uploadId)).toEqual({
      ok: false,
      error: "The template's file changed while this one was being saved. Reload the page and try again.",
    });
    expect(await template(id)).toMatchObject({ docxStoragePath: otherKey });
    expect(await status(up.uploadId)).toEqual({ status: "stored", failureReason: "" });
  });

  it("refuses an upload filed for another template, a file that isn't a readable .docx, and a template that isn't there", async () => {
    const one = await newTemplate("One");
    const two = await newTemplate("Two");
    const up = await uploaded(await docx("{organizationName}"));
    expect(await attachTemplateDocxFromUploadAction(one, up.uploadId)).toMatchObject({ ok: true });
    expect(await attachTemplateDocxFromUploadAction(two, up.uploadId)).toEqual({ ok: false, error: "This file was already saved on another record." });
    expect(await template(two)).toMatchObject({ docxStoragePath: "" });
    expect(await attachTemplateDocxFromUploadAction("not-a-uuid", up.uploadId)).toEqual({ ok: false, error: "Template not found." });
    expect(await attachTemplateDocxFromUploadAction(randomUUID(), up.uploadId)).toEqual({ ok: false, error: "Template not found." });

    // Its table of contents is fine (it passes the upload check), but the main part's own header is damaged.
    const broken = (await docx("{organizationName}")).slice();
    const view = new DataView(broken.buffer);
    let damaged = 0;
    for (let p = 0; p + 34 <= broken.length; p++) {
      if (view.getUint32(p, true) === 0x04034b50 && new TextDecoder().decode(broken.subarray(p + 30, p + 30 + 17)) === "word/document.xml") {
        view.setUint32(p, 0, true);
        damaged++;
      }
    }
    expect(damaged).toBe(1);
    const bad = await uploaded(broken, "Damaged.docx");
    const res = await attachTemplateDocxFromUploadAction(two, bad.uploadId);
    expect(res).toMatchObject({ ok: false });
    expect(await status(bad.uploadId)).toMatchObject({ status: "failed", failureReason: "claim_failed" });
    expect(await kept(bad.key)).toBe(false);
    expect(await template(two)).toMatchObject({ docxStoragePath: "" });
  });
});
