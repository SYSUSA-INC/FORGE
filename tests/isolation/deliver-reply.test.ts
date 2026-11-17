/**
 * BL-NAV-LIFECYCLE 6d-1 — Reply from the portal against Postgres. Two
 * tenants. Asserts: tenant B cannot answer tenant A's message, nor can
 * a message be answered through another opportunity; only the people
 * who may submit may answer; a delivery failure has no one to answer;
 * the answer goes to the message's stored sender with `In-Reply-To` and
 * `References` set to its Message-ID, from the opportunity's own
 * address, once; it passes no sign-off gate, moves no stage, raises no
 * submission activity or audit, and is filed as correspondence; an
 * uploaded file is attached and kept; a refused send is marked failed;
 * a receipt cannot be attached to an answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  runDurable: vi.fn(async (..._args: unknown[]) => ({ jobId: "job", reused: false })),
  sendEmailTracked: vi.fn(async (..._args: unknown[]): Promise<{ stubbed: true } | { stubbed: false; id: string }> => ({ stubbed: false, id: "re_789" })),
}));
vi.mock("@/lib/jobs", () => ({ runDurable: mocks.runDurable }));
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  sendEmailTracked: mocks.sendEmailTracked,
  emailConfigured: () => true,
}));

import { db } from "@/db";
import { auditLogs, fileUploads, inboundEmails, opportunities, opportunityActivities, proposalSubmissions, proposals, type BackgroundJob } from "@/db/schema";
import { queueReplySend, type SendReplyInput } from "@/lib/deliver-reply";
import { handleSubmissionSend } from "@/lib/deliver-send";
import { attachSubmissionReceipt, listSubmissions, type DeliverUser } from "@/lib/deliver-store";
import { EmailRefusedError } from "@/lib/email";
import { JobPermanentError } from "@/lib/jobs-policy";
import { getStorageProvider } from "@/lib/storage";
import { completeUpload, createUploadIntent } from "@/lib/uploads";
import { createTwoTenants, type TenantFixture, type TwoTenantFixture, withUploadPlans } from "../helpers/fixtures";

const FORM = new TextEncoder().encode("%PDF-1.7 answers to the questions");

describe("BL-NAV-LIFECYCLE 6d-1 — Reply from the portal", () => {
  let fx: TwoTenantFixture;
  let plans: (() => Promise<void>) | null = null;
  let emailA = "";
  const domainBefore = process.env.INBOUND_EMAIL_DOMAIN;

  async function inbound(t: TenantFixture, over: Partial<typeof inboundEmails.$inferInsert> = {}): Promise<string> {
    const [row] = await db
      .insert(inboundEmails)
      .values({
        organizationId: t.organizationId,
        providerMessageId: `<q-${Math.random().toString(36).slice(2)}@agency.gov>`,
        fromAddress: "co@agency.gov",
        fromName: "Pat Officer",
        subject: "Question on Volume II",
        kind: "proposal_reply",
        status: "parsed",
        opportunityId: t.opportunityId,
        replyType: "question",
        ...over,
      })
      .returning({ id: inboundEmails.id });
    return row!.id;
  }

  beforeEach(async () => {
    mocks.runDurable.mockClear();
    mocks.sendEmailTracked.mockReset();
    mocks.sendEmailTracked.mockResolvedValue({ stubbed: false, id: "re_789" });
    process.env.INBOUND_EMAIL_DOMAIN = "bids.example.com";
    fx = await createTwoTenants("deliver-reply");
    plans = await withUploadPlans(fx);
    emailA = await inbound(fx.orgA, { providerMessageId: "<q1@agency.gov>" });
  });

  afterEach(async () => {
    if (domainBefore === undefined) delete process.env.INBOUND_EMAIL_DOMAIN;
    else process.env.INBOUND_EMAIL_DOMAIN = domainBefore;
    await plans?.();
    await fx.cleanup();
  });

  const admin = (t: TenantFixture): DeliverUser => ({ id: t.userId, email: "lead@test.example", role: "admin", isSuperadmin: false });
  const input = (over: Partial<SendReplyInput> = {}): SendReplyInput => ({
    organizationId: fx.orgA.organizationId,
    opportunityId: fx.orgA.opportunityId,
    user: admin(fx.orgA),
    emailId: emailA,
    cc: "",
    ccSender: true,
    subject: "",
    body: "The answer is on page 12.",
    ...over,
  });
  const job = (submissionId: string): BackgroundJob => ({ organizationId: fx.orgA.organizationId, resourceId: submissionId, attempts: 1, maxAttempts: 3 }) as BackgroundJob;
  const rowOf = async (id: string) => (await db.select().from(proposalSubmissions).where(eq(proposalSubmissions.id, id)))[0]!;
  const audits = async (action: string) => db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, action)));
  const activities = async (kind: "submission" | "correspondence") => db.select().from(opportunityActivities).where(and(eq(opportunityActivities.opportunityId, fx.orgA.opportunityId), eq(opportunityActivities.kind, kind)));

  it("keeps tenant A's message from tenant B and refuses who and what cannot be answered", async () => {
    const B = fx.orgB;
    const gone = { ok: false, error: "This message is no longer available." };
    expect(await queueReplySend(input({ organizationId: B.organizationId, opportunityId: B.opportunityId, user: admin(B) }))).toEqual(gone);
    expect(await queueReplySend(input({ organizationId: B.organizationId, user: admin(B) }))).toEqual(gone);
    // A message is answered through its own opportunity only.
    const [other] = await db.insert(opportunities).values({ organizationId: fx.orgA.organizationId, title: "Another bid" }).returning({ id: opportunities.id });
    expect(await queueReplySend(input({ opportunityId: other!.id }))).toEqual(gone);

    const member = await queueReplySend(input({ user: { ...admin(fx.orgA), role: "member" } }));
    expect(member.ok === false && member.error).toMatch(/^Only an org admin/);
    const bounce = await inbound(fx.orgA, { fromAddress: "mailer-daemon@agency.gov", replyType: "delivery_failure" });
    const noOne = await queueReplySend(input({ emailId: bounce }));
    expect(noOne.ok === false && noOne.error).toMatch(/no one to answer/);
    expect((await queueReplySend(input({ body: "  " }))).ok).toBe(false);
    expect((await queueReplySend(input({ cc: "not an address" }))).ok).toBe(false);
    expect(await db.select().from(proposalSubmissions).where(eq(proposalSubmissions.organizationId, fx.orgA.organizationId))).toHaveLength(0);
    expect(mocks.runDurable).not.toHaveBeenCalled();
  });

  it("sends the answer once in the thread, with no gate and no stage change, and files it as correspondence", async () => {
    const A = fx.orgA;
    const stageBefore = (await db.select({ stage: proposals.stage }).from(proposals).where(eq(proposals.id, A.proposalId)))[0]!.stage;
    const oppBefore = (await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, A.opportunityId)))[0]!.stage;
    const intent = await createUploadIntent({ organizationId: A.organizationId, actor: { userId: A.userId, email: null }, purpose: "document", fileName: "answers.pdf", size: FORM.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [up] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, A.organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: up!.storageKey, bytes: FORM, contentType: up!.contentType });
    const done = await completeUpload({ organizationId: A.organizationId, actor: { userId: A.userId, email: null }, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);

    // No sign-off exists on this proposal and no override reason is given: an answer asks for neither.
    const res = await queueReplySend(input({ cc: "specialist@agency.gov", uploads: [{ uploadId: intent.uploadId, fileName: "" }] }));
    if (!res.ok) throw new Error(res.error);
    const queued = await rowOf(res.submissionId);
    expect(queued).toMatchObject({ method: "portal_email", status: "sending", inReplyToEmailId: emailA, recipientsTo: ["co@agency.gov"], recipientsCc: ["specialist@agency.gov", "lead@test.example"], subject: "RE: Question on Volume II", overrideReason: "" });
    expect(queued.fromAddress).toMatch(/^sub-[a-z0-9]{10}@bids\.example\.com$/);
    expect(mocks.runDurable).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "submission_send", resourceId: res.submissionId }));

    await handleSubmissionSend(job(res.submissionId));
    await handleSubmissionSend(job(res.submissionId));
    expect(mocks.sendEmailTracked).toHaveBeenCalledTimes(1);
    const sent = mocks.sendEmailTracked.mock.calls[0]![0] as { to: string[]; replyTo: string; headers: Record<string, string>; attachments: { filename: string; content: Buffer }[]; idempotencyKey: string };
    expect(sent.to).toEqual(["co@agency.gov"]);
    expect(sent.replyTo).toBe(queued.fromAddress);
    expect(sent.headers).toEqual({ "In-Reply-To": "<q1@agency.gov>", References: "<q1@agency.gov>" });
    expect(sent.idempotencyKey).toBe(`submission-send/${res.submissionId}`);
    expect(sent.attachments.map((a) => a.filename)).toEqual(["answers.pdf"]);
    expect(Buffer.compare(sent.attachments[0]!.content, Buffer.from(FORM))).toBe(0);

    expect(await rowOf(res.submissionId)).toMatchObject({ status: "sent", messageId: "re_789" });
    // Not a submission: nothing moved, nothing says "submitted".
    expect((await db.select({ stage: proposals.stage, submittedAt: proposals.submittedAt }).from(proposals).where(eq(proposals.id, A.proposalId)))[0]).toEqual({ stage: stageBefore, submittedAt: null });
    expect((await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, A.opportunityId)))[0]!.stage).toBe(oppBefore);
    expect(await activities("submission")).toHaveLength(0);
    expect(await audits("proposal.submission.sent")).toHaveLength(0);
    expect(mocks.runDurable).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "proposal_harvest" }));
    const filed = await activities("correspondence");
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ title: "Reply sent: RE: Question on Volume II", userId: A.userId });
    const audit = await audits("opportunity.correspondence.replied");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ submissionId: res.submissionId, emailId: emailA, recipients: ["co@agency.gov"], threaded: true, messageId: "re_789" });

    const listed = await listSubmissions(A.organizationId, A.opportunityId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ inReplyToEmailId: emailA, status: "sent" });
    expect(listed[0]!.files[0]).toMatchObject({ kind: "extra", fileName: "answers.pdf", kept: true });
    expect(await listSubmissions(fx.orgB.organizationId, A.opportunityId)).toHaveLength(0);
    expect(await attachSubmissionReceipt({ organizationId: A.organizationId, opportunityId: A.opportunityId, submissionId: res.submissionId, user: admin(A), uploadId: intent.uploadId })).toEqual({ ok: false, error: "Submission not found." });
  });

  it("sends without thread headers when FORGE holds no Message-ID, and marks a refused answer failed", async () => {
    const plain = await inbound(fx.orgA, { providerMessageId: "AAMkAGraphOwnId=", subject: "re: Receipt" });
    const res = await queueReplySend(input({ emailId: plain, ccSender: false }));
    if (!res.ok) throw new Error(res.error);
    expect((await rowOf(res.submissionId)).subject).toBe("re: Receipt");
    await handleSubmissionSend(job(res.submissionId));
    expect((mocks.sendEmailTracked.mock.calls[0]![0] as { headers?: unknown }).headers).toBeUndefined();
    expect((await audits("opportunity.correspondence.replied"))[0]!.metadata).toMatchObject({ threaded: false });

    const refused = await queueReplySend(input());
    if (!refused.ok) throw new Error(refused.error);
    mocks.sendEmailTracked.mockRejectedValueOnce(new EmailRefusedError("The bids.example.com domain is not verified."));
    await expect(handleSubmissionSend(job(refused.submissionId))).rejects.toBeInstanceOf(JobPermanentError);
    expect(await rowOf(refused.submissionId)).toMatchObject({ status: "failed", sentAt: null, inReplyToEmailId: emailA });
    expect(await activities("correspondence")).toHaveLength(1);
    expect((await audits("proposal.submission.send_failed"))[0]!.metadata).toMatchObject({ inReplyToEmailId: emailA });
  });
});
