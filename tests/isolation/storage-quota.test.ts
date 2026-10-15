/**
 * BL-STAB-2e — one storage meter, checked when an upload starts, and the
 * Office zip check at upload (Postgres; memory storage stands in for R2):
 * the meter counts every stored file (knowledge, solicitations, companion
 * documents, templates) and every upload in progress, each once; an upload
 * that would go over the plan's limit is refused before a byte is sent;
 * a workspace with no plan is told so; an Office file whose table of
 * contents is a zip bomb or password-protected is refused at its check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { fileUploads, knowledgeArtifacts, proposalTemplates, solicitationDocuments, solicitations, tenantSubscriptions } from "@/db/schema";
import { getStorageProvider } from "@/lib/storage";
import { getStorageBytesUsed } from "@/lib/subscription-gates";
import { claimUpload, completeUpload, createUploadIntent, finishClaim } from "@/lib/uploads";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";
import { forgeEntry, officeZip } from "../helpers/zip-fixtures";

const GIB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;
const TEXT = new TextEncoder().encode("Section C. The contractor shall staff the help desk.\n");

describe("BL-STAB-2e — one storage meter and the Office zip check (runtime)", () => {
  let fx: TwoTenantFixture;
  const tiers: { cleanup: () => Promise<void> }[] = [];
  const org = () => fx.orgA.organizationId;
  const actor = () => ({ userId: fx.orgA.userId, email: null });

  beforeEach(async () => {
    fx = await createTwoTenants("storage-quota");
    tiers.push(await createTierAndSubscribe({ organizationId: org(), slug: `sq-${org().slice(0, 8)}`, name: "Unlimited" }));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const t of tiers.splice(0)) await t.cleanup();
    await fx.cleanup();
  });

  async function intent(fileName: string, bytes: Uint8Array, purpose: "document" | "chat_attachment" = "document") {
    return createUploadIntent({ organizationId: org(), actor: actor(), purpose, fileName, size: bytes.byteLength, origin: "" });
  }
  async function arrived(fileName: string, bytes: Uint8Array) {
    const res = await intent(fileName, bytes);
    if (!res.ok) throw new Error(res.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, res.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    return { uploadId: res.uploadId, key: row!.storageKey };
  }

  it("counts every stored file and every upload in progress, each once, per organization", async () => {
    const before = await getStorageBytesUsed(org());
    const [sol] = await db.insert(solicitations).values({ organizationId: org(), title: "RFP", storagePath: `org/${org()}/uploads/x`, fileSize: 1_000, parseStatus: "parsed" }).returning({ id: solicitations.id });
    // A solicitation with no stored file (entered by hand) isn't counted.
    await db.insert(solicitations).values({ organizationId: org(), title: "Typed in", storagePath: "", fileSize: 5_000, parseStatus: "parsed" });
    await db.insert(solicitationDocuments).values({ organizationId: org(), solicitationId: sol!.id, documentType: "pws", fileName: "PWS.pdf", storagePath: `org/${org()}/uploads/y`, fileSize: 2_000, parseStatus: "parsed" });
    await db.insert(proposalTemplates).values({ organizationId: org(), name: "House style", docxStoragePath: `org/${org()}/uploads/z`, docxFileSize: 3_000 });
    await db.insert(knowledgeArtifacts).values({ organizationId: org(), kind: "note", source: "uploaded", title: "n", fileName: "n.txt", fileSize: 400, status: "indexed" });
    expect(await getStorageBytesUsed(org())).toBe(before + 1_000 + 2_000 + 3_000 + 400);

    // Uploads in progress count by their declared size, once.
    const pending = await intent("pending.txt", TEXT);
    if (!pending.ok) throw new Error(pending.error);
    const up = await arrived("stored.txt", TEXT);
    const done = await completeUpload({ organizationId: org(), actor: actor(), uploadId: up.uploadId });
    if (!done.ok) throw new Error(done.error);
    const withUploads = before + 6_400 + 2 * TEXT.byteLength;
    expect(await getStorageBytesUsed(org())).toBe(withUploads);
    // Filed: counted as its record instead of as an upload.
    const claim = await claimUpload({ organizationId: org(), userId: fx.orgA.userId, uploadId: up.uploadId, resourceType: "knowledge_artifact" });
    if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
    await db.insert(knowledgeArtifacts).values({ id: claim.claim.resourceId, organizationId: org(), kind: "note", source: "uploaded", title: "s", fileName: "stored.txt", fileSize: TEXT.byteLength, storagePath: up.key, status: "uploaded" });
    await finishClaim({ organizationId: org(), uploadId: up.uploadId, claimedAt: claim.claim.claimedAt });
    expect(await getStorageBytesUsed(org())).toBe(withUploads);
    // Another organization's meter is its own.
    expect(await getStorageBytesUsed(fx.orgB.organizationId)).toBeLessThan(before + 1);
  });

  it("refuses an upload that would go over the plan's limit before a byte is sent; a workspace with no plan is told so", async () => {
    for (const t of tiers.splice(0)) await t.cleanup();
    tiers.push(await createTierAndSubscribe({ organizationId: org(), slug: `sq1-${org().slice(0, 8)}`, name: "One GB", quotas: { storageGb: 1 } }));
    // Solicitations count now: one fills the plan.
    await db.insert(solicitations).values({ organizationId: org(), title: "Big RFP", storagePath: `org/${org()}/uploads/big`, fileSize: GIB, parseStatus: "parsed" });
    expect(await intent("more.txt", TEXT)).toMatchObject({ ok: false, code: "storage_quota", error: expect.stringMatching(/^Storage limit reached on the One GB tier/) });
    // A chat attachment is read and deleted, so it doesn't count.
    expect(await intent("ask.txt", TEXT, "chat_attachment")).toMatchObject({ ok: true });

    for (const t of tiers.splice(0)) await t.cleanup();
    expect(await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, org()))).toEqual([]);
    expect(await intent("more.txt", TEXT)).toMatchObject({ ok: false, code: "storage_quota", error: expect.stringMatching(/no plan assigned.*Admin → Organizations/) });
  });

  it("refuses an Office file whose table of contents is a zip bomb or password-protected, and stores a real one", async () => {
    const real = await arrived("Proposal.docx", await officeZip("docx"));
    expect(await completeUpload({ organizationId: org(), actor: actor(), uploadId: real.uploadId })).toMatchObject({ ok: true, upload: { status: "stored" } });

    const bomb = await arrived("Pricing.xlsx", forgeEntry(await officeZip("xlsx"), "xl/workbook.xml", { uncompressed: 50 * MiB, compressed: 10_000 }));
    expect(await completeUpload({ organizationId: org(), actor: actor(), uploadId: bomb.uploadId })).toMatchObject({
      ok: false,
      code: "rejected",
      error: expect.stringMatching(/expands to far more than its size.*Excel/),
    });
    const [rejected] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, org()), eq(fileUploads.id, bomb.uploadId)));
    expect(rejected).toMatchObject({ status: "failed", failureReason: "zip_rejected" });
    expect(await getStorageProvider().head(bomb.key)).toBeNull();

    const locked = await arrived("Briefing.pptx", forgeEntry(await officeZip("pptx"), "ppt/presentation.xml", { flags: 0x1 }));
    expect(await completeUpload({ organizationId: org(), actor: actor(), uploadId: locked.uploadId })).toMatchObject({ ok: false, error: expect.stringMatching(/password-protected/) });

    // A storage error during the check is not the file's fault: try again.
    const later = await arrived("Later.docx", await officeZip("docx"));
    const range = vi.spyOn(getStorageProvider(), "getRange");
    range.mockImplementationOnce(async (key, start, end) => (await getStorageProvider().get(key))!.bytes.subarray(start, end + 1));
    range.mockRejectedValueOnce(new Error("timed out"));
    expect(await completeUpload({ organizationId: org(), actor: actor(), uploadId: later.uploadId })).toMatchObject({ ok: false, code: "storage_unavailable", retryable: true });
    range.mockRestore();
    expect(await completeUpload({ organizationId: org(), actor: actor(), uploadId: later.uploadId })).toMatchObject({ ok: true });
  });
});
