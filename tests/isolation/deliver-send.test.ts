/**
 * BL-NAV-LIFECYCLE 6b — Send from FORGE against Postgres. Two tenants.
 * Asserts: tenant B cannot send on tenant A's opportunity or attach A's
 * render; sending is refused when it is not set up, when the gate is not
 * clear, and above 35 MB; the opportunity gets one `sub-` address and
 * keeps it; the job sends once (a second run does nothing), keeps a copy
 * with its SHA-256, marks the row sent and delivery as Record submission
 * does; a refusal or a stubbed send marks the row failed and never
 * submitted; a network error is retried under the same idempotency key.
 */

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  runDurable: vi.fn(async (..._args: unknown[]) => ({ jobId: "job", reused: false })),
  sendEmailTracked: vi.fn(async (..._args: unknown[]): Promise<{ stubbed: true } | { stubbed: false; id: string }> => ({ stubbed: false, id: "re_123" })),
  configured: { value: true },
}));
vi.mock("@/lib/jobs", () => ({ runDurable: mocks.runDurable }));
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  sendEmailTracked: mocks.sendEmailTracked,
  emailConfigured: () => mocks.configured.value,
}));

import { db } from "@/db";
import { auditLogs, opportunities, opportunityActivities, proposalPdfRenders, proposalSubmissions, proposals, type BackgroundJob } from "@/db/schema";
import { ensureDeliveryAddress, handleSubmissionSend, queueSubmissionSend, type SendSubmissionInput } from "@/lib/deliver-send";
import { loadDeliver, type DeliverUser } from "@/lib/deliver-store";
import { EmailRefusedError } from "@/lib/email";
import { JobPermanentError } from "@/lib/jobs-policy";
import { getStorageProvider } from "@/lib/storage";
import { createTwoTenants, type TenantFixture, type TwoTenantFixture } from "../helpers/fixtures";

const BYTES = new TextEncoder().encode("%PDF-1.7 tenant A final proposal");
const REASON = "Deadline is today; Gold was skipped.";

async function addRender(t: TenantFixture, bytes: Uint8Array): Promise<string> {
  const [row] = await db
    .insert(proposalPdfRenders)
    .values({ proposalId: t.proposalId, organizationId: t.organizationId, storagePath: "pending", contentType: "pdf", byteSize: bytes.byteLength, provider: "browserless" })
    .returning({ id: proposalPdfRenders.id });
  const storagePath = `org/${t.organizationId}/proposal/${t.proposalId}/render/${row!.id}.pdf`;
  await getStorageProvider().put({ key: storagePath, bytes, contentType: "application/pdf" });
  await db.update(proposalPdfRenders).set({ storagePath }).where(eq(proposalPdfRenders.id, row!.id));
  return row!.id;
}

describe("BL-NAV-LIFECYCLE 6b — Send from FORGE", () => {
  let fx: TwoTenantFixture;
  let renderA = "";
  const domainBefore = process.env.INBOUND_EMAIL_DOMAIN;

  beforeEach(async () => {
    mocks.runDurable.mockClear();
    mocks.sendEmailTracked.mockReset();
    mocks.sendEmailTracked.mockResolvedValue({ stubbed: false, id: "re_123" });
    mocks.configured.value = true;
    process.env.INBOUND_EMAIL_DOMAIN = "bids.example.com";
    fx = await createTwoTenants("deliver-send");
    renderA = await addRender(fx.orgA, BYTES);
  });

  afterEach(async () => {
    if (domainBefore === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = domainBefore;
    await fx.cleanup();
  });

  const admin = (t: TenantFixture): DeliverUser => ({ id: t.userId, email: "lead@test.example", role: "admin", isSuperadmin: false });
  const input = (over: Partial<SendSubmissionInput> = {}): SendSubmissionInput => ({
    organizationId: fx.orgA.organizationId,
    opportunityId: fx.orgA.opportunityId,
    user: admin(fx.orgA),
    to: "co@agency.gov",
    cc: "specialist@agency.gov",
    ccSender: true,
    subject: "W91-26-R-0007: Proposal submission",
    body: "Please find our proposal attached.",
    files: [{ renderId: renderA, fileName: "Volume I - Technical.pdf" }],
    overrideReason: REASON,
    ...over,
  });
  const job = (submissionId: string, attempts = 1): BackgroundJob => ({ organizationId: fx.orgA.organizationId, resourceId: submissionId, attempts, maxAttempts: 3 }) as BackgroundJob;
  const rowOf = async (id: string) => (await db.select().from(proposalSubmissions).where(eq(proposalSubmissions.id, id)))[0]!;
  const stageOf = async () => (await db.select({ stage: proposals.stage }).from(proposals).where(eq(proposals.id, fx.orgA.proposalId)))[0]!.stage;
  const audits = async (action: string) => db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, action)));

  it("keeps tenant A's opportunity and renders from tenant B, and refuses what cannot be sent", async () => {
    const B = fx.orgB;
    expect(await queueSubmissionSend(input({ organizationId: B.organizationId, user: admin(B) }))).toEqual({ ok: false, error: "Opportunity not found." });
    const foreign = await queueSubmissionSend(input({ organizationId: B.organizationId, opportunityId: B.opportunityId, user: admin(B) }));
    expect(foreign.ok).toBe(false);
    expect(await ensureDeliveryAddress(B.organizationId, fx.orgA.opportunityId)).toBeNull();

    const noGate = await queueSubmissionSend(input({ overrideReason: undefined }));
    expect(noGate.ok === false && noGate.error).toMatch(/^Sign-off is not complete/);
    expect((await queueSubmissionSend(input({ to: "" }))).ok).toBe(false);
    expect((await queueSubmissionSend(input({ files: [] }))).ok).toBe(false);
    await db.update(proposalPdfRenders).set({ byteSize: 36 * 1024 * 1024 }).where(eq(proposalPdfRenders.id, renderA));
    const big = await queueSubmissionSend(input());
    expect(big.ok === false && big.error).toMatch(/over 35 MB/);
    await db.update(proposalPdfRenders).set({ byteSize: BYTES.byteLength }).where(eq(proposalPdfRenders.id, renderA));

    mocks.configured.value = false;
    const off = await queueSubmissionSend(input());
    expect(off.ok === false && off.error).toMatch(/not set up/);
    expect((await loadDeliver({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, user: admin(fx.orgA) }))!.send.configured).toBe(false);

    expect(await db.select().from(proposalSubmissions)).toHaveLength(0);
    expect(mocks.runDurable).not.toHaveBeenCalled();
  });

  it("sends once from the opportunity's own address and marks delivery", async () => {
    const A = fx.orgA;
    const res = await queueSubmissionSend(input());
    if (!res.ok) throw new Error(res.error);
    expect(res.overridden).toBe(true);
    const address = await ensureDeliveryAddress(A.organizationId, A.opportunityId);
    expect(address).toMatch(/^sub-[a-z0-9]{10}@bids\.example\.com$/);
    const [opp] = await db.select({ local: opportunities.deliveryLocalPart }).from(opportunities).where(eq(opportunities.id, A.opportunityId));
    expect(`${opp!.local}@bids.example.com`).toBe(address);

    const queued = await rowOf(res.submissionId);
    expect(queued).toMatchObject({ status: "sending", method: "portal_email", fromAddress: address, replyAddress: address, recipientsTo: ["co@agency.gov"], recipientsCc: ["specialist@agency.gov", "lead@test.example"], overrideReason: REASON });
    expect(mocks.runDurable).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "submission_send", resourceId: res.submissionId, organizationId: A.organizationId }));
    expect(await stageOf()).not.toBe("submitted");
    expect(await audits("proposal.submission.gate_override")).toHaveLength(1);
    mocks.runDurable.mockClear();

    await handleSubmissionSend(job(res.submissionId));
    await handleSubmissionSend(job(res.submissionId));
    expect(mocks.sendEmailTracked).toHaveBeenCalledTimes(1);
    const sent = mocks.sendEmailTracked.mock.calls[0]![0] as { from: string; replyTo: string; to: string[]; cc: string[]; idempotencyKey: string; attachments: { filename: string; content: Buffer }[] };
    expect(sent.from).toMatch(new RegExp(`^".+ via FORGE" <${address}>$`));
    expect(sent).toMatchObject({ replyTo: address, to: ["co@agency.gov"], cc: ["specialist@agency.gov", "lead@test.example"], idempotencyKey: `submission-send/${res.submissionId}` });
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]!.filename).toBe("Volume I - Technical.pdf");
    expect(Buffer.compare(sent.attachments[0]!.content, Buffer.from(BYTES))).toBe(0);

    const done = await rowOf(res.submissionId);
    expect(done).toMatchObject({ status: "sent", messageId: "re_123", error: "" });
    expect(done.sentAt).not.toBeNull();
    const sha = createHash("sha256").update(BYTES).digest("hex");
    expect(done.files[0]).toMatchObject({ fileName: "Volume I - Technical.pdf", sha256: sha, storagePath: `org/${A.organizationId}/submission/${res.submissionId}/Volume I - Technical.pdf` });
    expect((await getStorageProvider().get(done.files[0]!.storagePath))?.bytes.byteLength).toBe(BYTES.byteLength);

    expect(await stageOf()).toBe("submitted");
    expect((await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, A.opportunityId)))[0]!.stage).toBe("submitted");
    const activity = await db.select().from(opportunityActivities).where(and(eq(opportunityActivities.opportunityId, A.opportunityId), eq(opportunityActivities.kind, "submission")));
    expect(activity).toHaveLength(1);
    const audit = await audits("proposal.submission.sent");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ submissionId: res.submissionId, messageId: "re_123", from: address, overridden: true });
    expect(mocks.runDurable).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "proposal_harvest", resourceId: A.proposalId }));

    // A second submission keeps the opportunity's address.
    const again = await queueSubmissionSend(input());
    if (!again.ok) throw new Error(again.error);
    expect((await rowOf(again.submissionId)).fromAddress).toBe(address);
  });

  it("marks a refused or a stubbed send failed, never submitted", async () => {
    const refused = await queueSubmissionSend(input());
    if (!refused.ok) throw new Error(refused.error);
    mocks.sendEmailTracked.mockRejectedValueOnce(new EmailRefusedError("The bids.example.com domain is not verified."));
    await expect(handleSubmissionSend(job(refused.submissionId))).rejects.toBeInstanceOf(JobPermanentError);
    expect(await rowOf(refused.submissionId)).toMatchObject({ status: "failed", error: "The bids.example.com domain is not verified.", messageId: "", sentAt: null });

    const stubbed = await queueSubmissionSend(input());
    if (!stubbed.ok) throw new Error(stubbed.error);
    mocks.sendEmailTracked.mockResolvedValueOnce({ stubbed: true });
    await expect(handleSubmissionSend(job(stubbed.submissionId))).rejects.toBeInstanceOf(JobPermanentError);
    expect((await rowOf(stubbed.submissionId)).status).toBe("failed");

    expect(await stageOf()).not.toBe("submitted");
    expect(await audits("proposal.submission.send_failed")).toHaveLength(2);
    expect(await audits("proposal.submission.sent")).toHaveLength(0);
    // A failed row is never sent again.
    await handleSubmissionSend(job(refused.submissionId));
    expect(mocks.sendEmailTracked).toHaveBeenCalledTimes(2);
  });

  it("tries a network error again under the same key, and fails the row when the attempts are spent", async () => {
    const res = await queueSubmissionSend(input());
    if (!res.ok) throw new Error(res.error);
    mocks.sendEmailTracked.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(handleSubmissionSend(job(res.submissionId, 1))).rejects.toThrow("fetch failed");
    expect((await rowOf(res.submissionId)).status).toBe("sending");
    await handleSubmissionSend(job(res.submissionId, 2));
    expect((await rowOf(res.submissionId)).status).toBe("sent");
    const keys = mocks.sendEmailTracked.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual([`submission-send/${res.submissionId}`, `submission-send/${res.submissionId}`]);

    const spent = await queueSubmissionSend(input());
    if (!spent.ok) throw new Error(spent.error);
    mocks.sendEmailTracked.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(handleSubmissionSend(job(spent.submissionId, 3))).rejects.toBeInstanceOf(JobPermanentError);
    expect(await rowOf(spent.submissionId)).toMatchObject({ status: "failed", error: "fetch failed" });
  });
});
