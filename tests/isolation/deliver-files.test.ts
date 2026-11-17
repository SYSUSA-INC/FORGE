/**
 * BL-NAV-LIFECYCLE 6b-2 — a submission's files against Postgres. Two
 * tenants. Asserts: an uploaded extra is claimed by upload id, sent with
 * the render and kept at its own key, and a refused send frees it again;
 * a receipt is attached to a submission on record by upload id with its
 * SHA-256; tenant B cannot use tenant A's upload, attach to A's
 * submission or read A's kept files.
 */

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  runDurable: vi.fn(async (..._args: unknown[]) => ({ jobId: "job", reused: false })),
  sendEmailTracked: vi.fn(async (..._args: unknown[]) => ({ stubbed: false as const, id: "re_456" })),
}));
vi.mock("@/lib/jobs", () => ({ runDurable: mocks.runDurable }));
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  sendEmailTracked: mocks.sendEmailTracked,
  emailConfigured: () => true,
}));

import { db } from "@/db";
import { auditLogs, fileUploads, proposalPdfRenders, proposalSubmissions, type BackgroundJob } from "@/db/schema";
import { handleSubmissionSend, queueSubmissionSend } from "@/lib/deliver-send";
import { attachSubmissionReceipt, listSubmissions, readSubmissionFile, recordSubmission, type DeliverUser } from "@/lib/deliver-store";
import { getStorageProvider } from "@/lib/storage";
import { completeUpload, createUploadIntent } from "@/lib/uploads";
import { createTwoTenants, type TenantFixture, type TwoTenantFixture, withUploadPlans } from "../helpers/fixtures";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7 tenant A final proposal");
const FORM = enc("%PDF-1.7 signed SF-1449");
const REASON = "Deadline is today; Gold was skipped.";

describe("BL-NAV-LIFECYCLE 6b-2 — a submission's files", () => {
  let fx: TwoTenantFixture;
  let renderA = "";
  let plans: (() => Promise<void>) | null = null;
  const domainBefore = process.env.INBOUND_EMAIL_DOMAIN;

  beforeEach(async () => {
    mocks.runDurable.mockClear();
    mocks.sendEmailTracked.mockClear();
    process.env.INBOUND_EMAIL_DOMAIN = "bids.example.com";
    fx = await createTwoTenants("deliver-files");
    plans = await withUploadPlans(fx);
    const A = fx.orgA;
    const [row] = await db
      .insert(proposalPdfRenders)
      .values({ proposalId: A.proposalId, organizationId: A.organizationId, storagePath: "pending", contentType: "pdf", byteSize: PDF.byteLength, provider: "browserless" })
      .returning({ id: proposalPdfRenders.id });
    renderA = row!.id;
    const storagePath = `org/${A.organizationId}/proposal/${A.proposalId}/render/${renderA}.pdf`;
    await getStorageProvider().put({ key: storagePath, bytes: PDF, contentType: "application/pdf" });
    await db.update(proposalPdfRenders).set({ storagePath }).where(eq(proposalPdfRenders.id, renderA));
  });

  afterEach(async () => {
    if (domainBefore === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = domainBefore;
    await plans?.();
    await fx.cleanup();
  });

  const admin = (t: TenantFixture): DeliverUser => ({ id: t.userId, email: "lead@test.example", role: "admin", isSuperadmin: false });
  const member = (t: TenantFixture): DeliverUser => ({ id: t.userId, email: "m@test.example", role: "member", isSuperadmin: false });

  /** An upload checked in storage, as the browser's `uploadFile()` leaves it. */
  async function stored(t: TenantFixture, fileName: string, bytes: Uint8Array) {
    const actor = { userId: t.userId, email: null };
    const intent = await createUploadIntent({ organizationId: t.organizationId, actor, purpose: "document", fileName, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, t.organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId: t.organizationId, actor, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return { uploadId: intent.uploadId, key: row!.storageKey };
  }
  const statusOf = async (uploadId: string) => (await db.select({ status: fileUploads.status }).from(fileUploads).where(eq(fileUploads.id, uploadId)))[0]!.status;
  const send = (uploads: { uploadId: string; fileName: string }[], over: { to?: string } = {}) =>
    queueSubmissionSend({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      user: admin(fx.orgA),
      to: over.to ?? "co@agency.gov",
      cc: "",
      ccSender: false,
      subject: "Proposal submission",
      body: "Attached.",
      files: [{ renderId: renderA, fileName: "Volume I.pdf" }],
      uploads,
      overrideReason: REASON,
    });

  it("sends an uploaded extra with the render, keeps it, and frees it when the send is refused", async () => {
    const A = fx.orgA;
    const form = await stored(A, "SF 1449 signed.pdf", FORM);
    const foreign = await stored(fx.orgB, "theirs.pdf", FORM);

    // Tenant B's upload is not found here; a name clash is refused; both leave tenant A's upload free.
    expect((await send([{ uploadId: form.uploadId, fileName: "" }, { uploadId: foreign.uploadId, fileName: "" }])).ok).toBe(false);
    const clash = await send([{ uploadId: form.uploadId, fileName: "Volume I" }]);
    expect(clash.ok === false && clash.error).toMatch(/Two files are named/);
    expect(await statusOf(form.uploadId)).toBe("stored");
    expect(await statusOf(foreign.uploadId)).toBe("stored");
    expect(await db.select().from(proposalSubmissions)).toHaveLength(0);

    const res = await send([{ uploadId: form.uploadId, fileName: "SF-1449 (signed)" }]);
    if (!res.ok) throw new Error(res.error);
    expect(await statusOf(form.uploadId)).toBe("claimed");
    await handleSubmissionSend({ organizationId: A.organizationId, resourceId: res.submissionId, attempts: 1, maxAttempts: 3 } as BackgroundJob);

    const sent = mocks.sendEmailTracked.mock.calls[0]![0] as { attachments: { filename: string; content: Buffer }[] };
    expect(sent.attachments.map((a) => a.filename)).toEqual(["Volume I.pdf", "SF-1449 (signed).pdf"]);
    expect(Buffer.compare(sent.attachments[1]!.content, Buffer.from(FORM))).toBe(0);
    const [row] = await db.select().from(proposalSubmissions).where(eq(proposalSubmissions.id, res.submissionId));
    expect(row!.status).toBe("sent");
    expect(row!.files[1]).toMatchObject({ kind: "extra", renderId: null, storagePath: form.key, sha256: createHash("sha256").update(FORM).digest("hex") });

    // The kept files are read by position, by their own tenant only.
    const read = (organizationId: string, index: number) => readSubmissionFile({ organizationId, opportunityId: A.opportunityId, submissionId: res.submissionId, index });
    expect((await read(A.organizationId, 1))?.object?.bytes.byteLength).toBe(FORM.byteLength);
    expect((await read(A.organizationId, 0))?.file.fileName).toBe("Volume I.pdf");
    expect(await read(A.organizationId, 2)).toBeNull();
    expect(await read(fx.orgB.organizationId, 0)).toBeNull();
  });

  it("attaches a receipt to a submission on record, for its own tenant's leads only", async () => {
    const A = fx.orgA;
    const rec = await recordSubmission({ organizationId: A.organizationId, opportunityId: A.opportunityId, user: admin(A), method: "government_portal", sentAt: new Date().toISOString(), recipients: "", note: "", renderId: renderA, overrideReason: REASON });
    if (!rec.ok) throw new Error(rec.error);
    const receipt = await stored(A, "Portal confirmation.txt", enc("Confirmation 4411 received"));
    const attach = (organizationId: string, user: DeliverUser, uploadId = receipt.uploadId) => attachSubmissionReceipt({ organizationId, opportunityId: A.opportunityId, submissionId: rec.submissionId, user, uploadId });

    expect(await attach(fx.orgB.organizationId, admin(fx.orgB))).toEqual({ ok: false, error: "Submission not found." });
    expect((await attach(A.organizationId, member(A))).ok).toBe(false);
    const theirs = await stored(fx.orgB, "theirs.txt", enc("b"));
    expect((await attach(A.organizationId, admin(A), theirs.uploadId)).ok).toBe(false);
    expect(await statusOf(receipt.uploadId)).toBe("stored");

    expect(await attach(A.organizationId, admin(A))).toEqual({ ok: true });
    expect(await statusOf(receipt.uploadId)).toBe("claimed");
    const [listed] = await listSubmissions(A.organizationId, A.opportunityId);
    expect(listed!.files).toHaveLength(2);
    expect(listed!.files[1]).toMatchObject({ kind: "receipt", fileName: "Portal confirmation.txt", kept: true, sha256: createHash("sha256").update(enc("Confirmation 4411 received")).digest("hex") });
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, A.organizationId), eq(auditLogs.action, "proposal.submission.receipt_attached")));
    expect(audit).toHaveLength(1);
    // Attaching the same upload again changes nothing.
    expect(await attach(A.organizationId, admin(A))).toEqual({ ok: true });
    expect((await listSubmissions(A.organizationId, A.opportunityId))[0]!.files).toHaveLength(2);
  });
});
