/**
 * BL-STAB-2e — knowledge-base files upload straight to storage and are
 * read by a durable job (Postgres; memory storage stands in for R2;
 * background work is run by hand): a checked upload is saved once as an
 * artifact with the batch's kind, tags and outcome (the storage limit is
 * checked when the upload starts: storage-quota.test.ts); its text is read from storage within the read budget;
 * Re-extract queues the same job; a filing that died gets its extraction
 * from the upload sweep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, fileUploads, knowledgeArtifacts } from "@/db/schema";
import { executeJob, queueMissingParse } from "@/lib/jobs";
import { getStorageProvider } from "@/lib/storage";
import { claimUpload, completeUpload, createUploadIntent, sweepUploads } from "@/lib/uploads";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture, withUploadPlans } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@knowledge.test",
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
// Extraction is run by hand below, from storage, as the jobs cron would.
vi.mock("@/lib/background", () => ({ runInBackground: () => undefined, backgroundIsDurable: () => false }));
// A confident classifier, so Auto-detect's effect shows.
vi.mock("@/lib/knowledge-classify", () => ({
  CLASSIFY_CONFIDENCE_THRESHOLD: 0.7,
  classifyArtifactKind: async () => ({ ok: true, stubbed: false, kind: "proposal", confidence: 0.95, reasoning: "Reads as a proposal." }),
}));

import { createKnowledgeArtifactFromUploadAction, reextractArtifactTextAction } from "@/app/(app)/knowledge-base/import/actions";

const NOTE = new TextEncoder().encode(
  ["Past performance: Help desk support for the VA, 2021-2025.", "Staffed 7 a.m. to 7 p.m. Eastern; 98% first-call resolution."].join("\n"),
);

const GIB = 1024 * 1024 * 1024;

describe("BL-STAB-2e — knowledge files from direct uploads (runtime)", () => {
  let fx: TwoTenantFixture;
  let plans: (() => Promise<void>) | null = null;
  const org = () => fx.orgA.organizationId;

  beforeEach(async () => {
    fx = await createTwoTenants("knowledge-uploads");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    plans = await withUploadPlans(fx);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await plans?.();
    await fx.cleanup();
  });

  async function storedUpload(name = "past-performance.txt", bytes = NOTE, userId = fx.orgA.userId, organizationId = org()) {
    const intent = await createUploadIntent({ organizationId, actor: { userId, email: null }, purpose: "document", fileName: name, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId, actor: { userId, email: null }, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return { uploadId: intent.uploadId, key: row!.storageKey };
  }

  const jobsFor = (resourceId: string) =>
    db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.organizationId, org()), eq(backgroundJobs.resourceId, resourceId)));
  async function runExtraction(artifactId: string) {
    const open = (await jobsFor(artifactId)).filter((j) => j.status === "queued");
    expect(open).toHaveLength(1);
    await executeJob(open[0]!.id, org(), { viaCron: true });
    const [artifact] = await db.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.organizationId, org()), eq(knowledgeArtifacts.id, artifactId)));
    return artifact!;
  }

  it("saves a checked upload once, with the batch's kind, tags and outcome, and reads it from storage in the background", async () => {
    const { uploadId, key } = await storedUpload();
    const res = await createKnowledgeArtifactFromUploadAction({ uploadId, kind: "cpars", tags: "navy, fy26; help desk", outcome: "won" });
    if (!res.ok) throw new Error(res.error);
    expect(await createKnowledgeArtifactFromUploadAction({ uploadId })).toEqual({ ok: true, id: res.id });

    // The fixture seeds one artifact per organization; only ours is new.
    const rows = (await db.select().from(knowledgeArtifacts).where(eq(knowledgeArtifacts.organizationId, org()))).filter((r) => r.id !== fx.orgA.knowledgeArtifactId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: res.id,
      kind: "cpars",
      tags: ["navy", "fy26", "help desk"],
      outcomeLabel: "won",
      title: "past-performance",
      fileName: "past-performance.txt",
      fileSize: NOTE.byteLength,
      storagePath: key,
      status: "uploaded",
    });
    const [ledger] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, uploadId)));
    expect(ledger).toMatchObject({ status: "claimed", resourceType: "knowledge_artifact", purgeAfter: null });
    const [job] = await jobsFor(res.id);
    expect(job).toMatchObject({ kind: "knowledge_artifact_extract", status: "queued", payload: { wasAutoKind: false } });

    const read = await runExtraction(res.id);
    expect(read.status).toBe("indexed");
    expect(read.rawText).toContain("98% first-call resolution");
  });

  it("guesses the kind from the file when Auto-detect is chosen, and refuses another organization's upload", async () => {
    const { uploadId } = await storedUpload("notes.txt");
    const res = await createKnowledgeArtifactFromUploadAction({ uploadId });
    if (!res.ok) throw new Error(res.error);
    const [row] = await db.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.organizationId, org()), eq(knowledgeArtifacts.id, res.id)));
    expect(row).toMatchObject({ kind: "note", outcomeLabel: "none", tags: [] });
    const [job] = await jobsFor(res.id);
    expect(job!.payload).toEqual({ wasAutoKind: true });
    // Auto-detect: the classifier's confident answer replaces the file-type guess.
    expect(await runExtraction(res.id)).toMatchObject({ status: "indexed", kind: "proposal", aiSuggestedKind: "proposal" });

    // The same person's upload in another organization.
    const foreign = await storedUpload("theirs.txt", NOTE, fx.orgA.userId, fx.orgB.organizationId);
    expect(await createKnowledgeArtifactFromUploadAction({ uploadId: foreign.uploadId })).toEqual({ ok: false, error: "Upload not found." });
    expect((await db.select().from(knowledgeArtifacts).where(eq(knowledgeArtifacts.organizationId, fx.orgB.organizationId))).map((r) => r.id)).toEqual([fx.orgB.knowledgeArtifactId]);
  });

  it("a file over its read budget is kept and marked; Re-extract queues the read again", async () => {
    const { uploadId } = await storedUpload();
    const res = await createKnowledgeArtifactFromUploadAction({ uploadId });
    if (!res.ok) throw new Error(res.error);
    await db.update(knowledgeArtifacts).set({ fileSize: 200 * 1024 * 1024 }).where(and(eq(knowledgeArtifacts.organizationId, org()), eq(knowledgeArtifacts.id, res.id)));
    const get = vi.spyOn(getStorageProvider(), "get");
    const over = await runExtraction(res.id);
    expect(over).toMatchObject({ status: "failed", statusError: expect.stringMatching(/reads files of this type up to 25 MB automatically/) });
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();

    await db.update(knowledgeArtifacts).set({ fileSize: NOTE.byteLength }).where(and(eq(knowledgeArtifacts.organizationId, org()), eq(knowledgeArtifacts.id, res.id)));
    expect(await reextractArtifactTextAction(res.id)).toEqual({ ok: true, queued: true });
    expect(await runExtraction(res.id)).toMatchObject({ status: "indexed" });
    expect((await jobsFor(res.id)).map((j) => j.status).sort()).toEqual(["done", "failed"]);
  });

  it("Re-extract tells storage that can't be reached from a file that is gone", async () => {
    const { uploadId } = await storedUpload();
    const res = await createKnowledgeArtifactFromUploadAction({ uploadId });
    if (!res.ok) throw new Error(res.error);
    const head = vi.spyOn(getStorageProvider(), "head").mockRejectedValueOnce(new Error("timed out"));
    expect(await reextractArtifactTextAction(res.id)).toEqual({ ok: false, error: "File storage could not be reached just now. Try Re-extract again in a minute." });
    head.mockResolvedValueOnce(null);
    expect(await reextractArtifactTextAction(res.id)).toMatchObject({ ok: false, error: expect.stringMatching(/Storage no longer has the file bytes/) });
  });

  it("a filing that died before queueing its read gets it from the upload sweep", async () => {
    const { uploadId, key } = await storedUpload();
    const claim = await claimUpload({ organizationId: org(), userId: fx.orgA.userId, uploadId, resourceType: "knowledge_artifact" });
    if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
    await db.insert(knowledgeArtifacts).values({ id: claim.claim.resourceId, organizationId: org(), kind: "note", source: "uploaded", title: "t", fileName: "past-performance.txt", fileSize: NOTE.byteLength, contentType: "text/plain", storagePath: key, status: "uploaded" });
    await db.update(fileUploads).set({ claimedAt: new Date(Date.now() - 31 * 60_000) }).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, uploadId)));
    await sweepUploads({ onPromoted: queueMissingParse });
    expect((await jobsFor(claim.claim.resourceId)).map((j) => [j.kind, j.status])).toEqual([["knowledge_artifact_extract", "queued"]]);
    // The batch's choice isn't known here: the classifier only suggests.
    expect(await runExtraction(claim.claim.resourceId)).toMatchObject({ status: "indexed", kind: "note", aiSuggestedKind: "proposal" });
  });

  it("a retry of a filing whose artifact was saved finishes it, reads it only if it never was, and isn't counted twice", async () => {
    const saveThenDie = async (name: string, withJob: boolean) => {
      const { uploadId, key } = await storedUpload(name);
      const claim = await claimUpload({ organizationId: org(), userId: fx.orgA.userId, uploadId, resourceType: "knowledge_artifact" });
      if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
      await db.insert(knowledgeArtifacts).values({ id: claim.claim.resourceId, organizationId: org(), kind: "note", source: "uploaded", title: name, fileName: name, fileSize: NOTE.byteLength, contentType: "text/plain", storagePath: key, status: withJob ? "indexed" : "uploaded" });
      if (withJob) await db.insert(backgroundJobs).values({ organizationId: org(), kind: "knowledge_artifact_extract", resourceId: claim.claim.resourceId, status: "done" });
      // Older than the takeover window: the retry takes the claim over.
      await db.update(fileUploads).set({ claimedAt: new Date(Date.now() - 3 * 60_000) }).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, uploadId)));
      return { uploadId, id: claim.claim.resourceId };
    };
    const unread = await saveThenDie("unread.txt", false);
    expect(await createKnowledgeArtifactFromUploadAction({ uploadId: unread.uploadId })).toEqual({ ok: true, id: unread.id });
    expect((await jobsFor(unread.id)).map((j) => j.status)).toEqual(["queued"]);
    const read = await saveThenDie("read.txt", true);
    expect(await createKnowledgeArtifactFromUploadAction({ uploadId: read.uploadId })).toEqual({ ok: true, id: read.id });
    expect((await jobsFor(read.id)).map((j) => j.status)).toEqual(["done"]);
    expect(await db.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.organizationId, org()), eq(knowledgeArtifacts.id, read.id)))).toHaveLength(1);

    // A full plan doesn't refuse the retry: the limit was checked when the upload started.
    await plans?.();
    plans = null;
    const limited = await createTierAndSubscribe({ organizationId: org(), slug: `ku2-${org().slice(0, 8)}`, name: "One GB", quotas: { storageGb: 1 } });
    try {
      const full = await saveThenDie("full.txt", false);
      await db.insert(knowledgeArtifacts).values({ organizationId: org(), kind: "other", source: "uploaded", title: "Filler", fileName: "filler.pdf", fileSize: GIB, status: "indexed" });
      expect(await createKnowledgeArtifactFromUploadAction({ uploadId: full.uploadId })).toEqual({ ok: true, id: full.id });
    } finally {
      await limited.cleanup();
    }
  });
});
