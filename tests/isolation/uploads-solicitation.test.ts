/**
 * BL-STAB-2c — a new solicitation or amendment from an upload straight to
 * storage: the checked upload is filed once, its parse reads the file
 * from storage, and the read refuses a file outside the organization,
 * over its read budget, or changed after its check. Also the
 * through-the-app upload. Postgres; memory storage stands in for R2;
 * background work is run by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, fileUploads, solicitations } from "@/db/schema";
import { executeJob } from "@/lib/jobs";
import { getStorageProvider } from "@/lib/storage";
import { completeUpload, createUploadIntent, receiveProxyUpload } from "@/lib/uploads";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@uploads.test",
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
// The parse is run by hand below, from storage, as the jobs cron would.
vi.mock("@/lib/background", () => ({ runInBackground: () => undefined, backgroundIsDurable: () => false }));

import { createSolicitationFromUploadAction, reparseSolicitationAction } from "@/app/(app)/solicitations/actions";

const RFP = new TextEncoder().encode(
  [
    "REQUEST FOR PROPOSAL 26-R-0042 — Help Desk Support Services",
    "Section C. The contractor shall staff the help desk from 7 a.m. to 7 p.m. Eastern on business days.",
    "Section L. Volume I (Technical) shall not exceed 25 pages in 12-point Times New Roman.",
    "Section M. Technical approach is more important than past performance.",
    "Proposals are due 1 November 2026 at 2 p.m. Eastern.",
  ].join("\n"),
);

describe("BL-STAB-2c — solicitations from direct uploads (runtime)", () => {
  let fx: TwoTenantFixture;
  const actorA = () => ({ userId: fx.orgA.userId, email: null });

  beforeEach(async () => {
    fx = await createTwoTenants("uploads-sol");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  async function storedUpload(name = "RFP.txt", bytes = RFP) {
    const intent = await createUploadIntent({ organizationId: fx.orgA.organizationId, actor: actorA(), purpose: "document", fileName: name, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return { uploadId: intent.uploadId, key: row!.storageKey };
  }

  async function runParse(solicitationId: string) {
    const [job] = await db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), eq(backgroundJobs.resourceId, solicitationId)));
    expect(job).toBeDefined();
    await executeJob(job!.id, fx.orgA.organizationId, { viaCron: true });
    const [sol] = await db.select().from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, solicitationId)));
    return sol!;
  }

  it("files a checked upload once as a solicitation and parses it from storage", async () => {
    const { uploadId, key } = await storedUpload();
    const res = await createSolicitationFromUploadAction({ uploadId });
    if (!res.ok) throw new Error(res.error);
    const again = await createSolicitationFromUploadAction({ uploadId });
    expect(again).toEqual({ ok: true, id: res.id });
    const rows = await db.select().from(solicitations).where(eq(solicitations.organizationId, fx.orgA.organizationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: res.id, fileName: "RFP.txt", fileSize: RFP.byteLength, contentType: "text/plain", storagePath: key, title: "RFP" });

    const parsed = await runParse(res.id);
    expect(parsed.parseStatus).toBe("parsed");
    expect(parsed.rawText).toContain("Help Desk Support Services");
  });

  it("an amendment needs a parent in this organization; a refused parent leaves the upload ready", async () => {
    const [foreign] = await db.insert(solicitations).values({ organizationId: fx.orgB.organizationId, title: "B's RFP", parseStatus: "parsed" }).returning({ id: solicitations.id });
    const { uploadId } = await storedUpload("Amendment 0001.txt");
    expect(await createSolicitationFromUploadAction({ uploadId, parentSolicitationId: foreign!.id, amendmentNumber: "0001" })).toEqual({
      ok: false,
      error: "Parent solicitation not found in this organization.",
    });
    const [still] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, uploadId)));
    expect(still!.status).toBe("stored");

    const [parent] = await db.insert(solicitations).values({ organizationId: fx.orgA.organizationId, title: "Base RFP", parseStatus: "parsed" }).returning({ id: solicitations.id });
    const res = await createSolicitationFromUploadAction({ uploadId, parentSolicitationId: parent!.id, amendmentNumber: "0001" });
    if (!res.ok) throw new Error(res.error);
    const [amendment] = await db.select().from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, res.id)));
    expect(amendment).toMatchObject({ parentSolicitationId: parent!.id, amendmentNumber: "0001" });
  });

  it("the parse refuses a file changed after its check, a file over its read budget, and a key outside the organization", async () => {
    const changed = await storedUpload("changed.txt");
    const a = await createSolicitationFromUploadAction({ uploadId: changed.uploadId });
    if (!a.ok) throw new Error(a.error);
    await getStorageProvider().put({ key: changed.key, bytes: new TextEncoder().encode("swapped after the check ".repeat(20)), contentType: "text/plain" });
    // The change is caught from the object's size and ETag before any download.
    const getChanged = vi.spyOn(getStorageProvider(), "get");
    expect(await runParse(a.id)).toMatchObject({ parseStatus: "failed", parseError: "The stored file changed after it was uploaded; upload it again." });
    expect(getChanged).not.toHaveBeenCalled();
    getChanged.mockRestore();

    const big = await storedUpload("big.txt");
    const b = await createSolicitationFromUploadAction({ uploadId: big.uploadId });
    if (!b.ok) throw new Error(b.error);
    await db.update(solicitations).set({ fileSize: 200 * 1024 * 1024 }).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, b.id)));
    // Over its read budget: refused before storage is even asked.
    const head = vi.spyOn(getStorageProvider(), "head");
    const get = vi.spyOn(getStorageProvider(), "get");
    const bigRow = await runParse(b.id);
    expect(bigRow.parseStatus).toBe("failed");
    expect(bigRow.parseError).toMatch(/reads files of this type up to 25 MB automatically; split it/);
    expect(head).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
    head.mockRestore();

    const foreign = await storedUpload("foreign.txt");
    const c = await createSolicitationFromUploadAction({ uploadId: foreign.uploadId });
    if (!c.ok) throw new Error(c.error);
    await db
      .update(solicitations)
      .set({ storagePath: `org/${fx.orgB.organizationId}/uploads/${foreign.uploadId}` })
      .where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, c.id)));
    expect(await runParse(c.id)).toMatchObject({ parseStatus: "failed", parseError: "The stored file could not be read." });
  });

  it("refuses uploads with the in-memory store on any Vercel deployment, naming the setup", async () => {
    const saved = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const refused = await createUploadIntent({ organizationId: fx.orgA.organizationId, actor: actorA(), purpose: "document", fileName: "RFP.txt", size: RFP.byteLength, origin: "" });
      expect(refused).toMatchObject({ ok: false, code: "storage_unconfigured" });
      expect((refused as { error: string }).error).toMatch(/Cloudflare R2.*Admin → Jobs → File storage/);
    } finally {
      if (saved === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = saved;
    }
  });

  it("Re-parse tells storage that can't be reached from a file that is gone", async () => {
    const up = await storedUpload("reparse.txt");
    const filed = await createSolicitationFromUploadAction({ uploadId: up.uploadId });
    if (!filed.ok) throw new Error(filed.error);
    const head = vi.spyOn(getStorageProvider(), "head").mockRejectedValueOnce(new Error("timed out"));
    expect(await reparseSolicitationAction(filed.id)).toEqual({ ok: false, error: "File storage could not be reached just now. Try Re-parse again in a minute." });
    head.mockResolvedValueOnce(null);
    expect(await reparseSolicitationAction(filed.id)).toMatchObject({ ok: false, error: expect.stringMatching(/no longer in storage/) });
    head.mockRestore();
  });

  it("through the app: checks type and length before reading, then stores and verifies", async () => {
    const intent = await createUploadIntent({ organizationId: fx.orgA.organizationId, actor: actorA(), purpose: "document", fileName: "RFP.txt", size: RFP.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    let reads = 0;
    const readBody = async () => {
      reads++;
      return RFP;
    };
    const base = { organizationId: fx.orgA.organizationId, actor: actorA(), uploadId: intent.uploadId, readBody };
    expect((await receiveProxyUpload({ ...base, contentType: "application/pdf", contentLength: RFP.byteLength })).status).toBe(415);
    expect((await receiveProxyUpload({ ...base, contentType: "text/plain", contentLength: RFP.byteLength + 1 })).status).toBe(413);
    expect((await receiveProxyUpload({ ...base, contentType: "text/plain", contentLength: null })).status).toBe(411);
    expect(reads).toBe(0);
    const other = await receiveProxyUpload({ ...base, organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId, email: null }, contentType: "text/plain", contentLength: RFP.byteLength });
    expect(other.status).toBe(404);
    const ok = await receiveProxyUpload({ ...base, contentType: "text/plain", contentLength: RFP.byteLength });
    expect(ok).toMatchObject({ status: 200, body: { ok: true, upload: { status: "stored", size: RFP.byteLength } } });
  });
});
