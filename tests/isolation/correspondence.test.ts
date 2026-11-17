/**
 * BL-NAV-LIFECYCLE 6c — replies to a submission against Postgres. Two
 * tenants. Asserts: mail to an opportunity's own address is kept in that
 * opportunity's tenant as a proposal_reply, tied to the submission the
 * sender was sent, and queued for the reply job, not the bid reader; an
 * unknown `sub-` address is left unrouted; the job files it once (type,
 * summary, the correspondence activity, the audit row, the default
 * notification rule) and changes no stage; a stranger or an unverified
 * sender is filed with the check-the-sender mark; bounces and automatic
 * replies are typed from headers; tenant B cannot list, open or download
 * tenant A's reply, and the bid inbox does not show it. 6c-2: a reply
 * the headers do not explain is read by FORGE AI (type, summary, date)
 * and still changes no stage; a bounce never reaches the model; with no
 * plan, no quota or a failed call the reply is filed with the fallback
 * and the request refunded; File as a document files one attachment on
 * the opportunity once, and tenant B cannot file tenant A's.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  runDurable: vi.fn(async (..._args: unknown[]) => ({ jobId: "job", reused: false })),
  enqueueJob: vi.fn(async (..._args: unknown[]) => ({ job: { id: "job" }, reused: false })),
  provider: { name: "stub" },
  complete: vi.fn(async (..._args: unknown[]): Promise<{ data: unknown; parseError?: string }> => ({ data: null })),
  ensureFeature: vi.fn(async (..._args: unknown[]) => undefined),
  enforceQuota: vi.fn(async (..._args: unknown[]) => undefined),
  refundQuota: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("@/lib/jobs", () => ({ runDurable: mocks.runDurable, enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/ai", async (original) => ({
  ...(await original<typeof import("@/lib/ai")>()),
  getAIProviderStatus: () => ({ active: { name: mocks.provider.name, configured: true } }),
  completeStructuredForTenant: mocks.complete,
}));
vi.mock("@/lib/subscription-gates", async (original) => ({
  ...(await original<typeof import("@/lib/subscription-gates")>()),
  ensureFeature: mocks.ensureFeature,
  enforceQuota: mocks.enforceQuota,
  refundQuota: mocks.refundQuota,
  enforceStorageQuota: async () => undefined,
}));
vi.mock("@/lib/background", () => ({ runInBackground: () => undefined }));

import { db } from "@/db";
import { auditLogs, inboundEmails, notificationRules, opportunities, opportunityActivities, proposalSubmissions, proposals, solicitations } from "@/db/schema";
import { fileReplyAttachment, handleSubmissionReply, listReplies, readReplyAttachment, readReplyText } from "@/lib/correspondence";
import { ensureDeliveryAddress } from "@/lib/deliver-send";
import { readInboundEmail } from "@/lib/inbound-bids";
import { listInboundEmails, receiveInboundMessage } from "@/lib/inbound-email";
import { FeatureGateError } from "@/lib/subscription-gates";
import { createTwoTenants, type TenantFixture, type TwoTenantFixture } from "../helpers/fixtures";

const CO = "co@agency.gov";
const SPF = [{ name: "Received-SPF", value: "Pass" }];
let n = 0;

async function addSubmission(t: TenantFixture, to: string[], status: "sent" | "failed" = "sent"): Promise<string> {
  const [row] = await db
    .insert(proposalSubmissions)
    .values({ organizationId: t.organizationId, opportunityId: t.opportunityId, proposalId: t.proposalId, method: "portal_email", status, recipientsTo: to, subject: "Proposal for 26-001", sentAt: new Date(), sentByUserId: t.userId })
    .returning({ id: proposalSubmissions.id });
  return row!.id;
}

function receive(to: string, o: { from?: string; subject?: string; text?: string; headers?: { name: string; value: string }[]; files?: { name: string; contentType: string; bytes: Uint8Array }[] } = {}) {
  return receiveInboundMessage(
    {
      messageId: `<reply-${++n}-${Date.now()}@agency.gov>`,
      from: o.from ?? CO,
      fromName: "Contracting Officer",
      recipients: [to],
      subject: o.subject ?? "RE: Proposal for 26-001",
      text: o.text ?? "We received your proposal.\nEvaluation begins Monday.\n\nOn Tue, Acme via FORGE wrote:\n> Please find attached",
      html: "",
      date: new Date().toISOString(),
      headers: o.headers ?? SPF,
    },
    o.files ?? [],
  );
}

const emailRow = async (id: string) => (await db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).limit(1))[0]!;

describe("replies to a submission", () => {
  let fx: TwoTenantFixture;
  let address: string;
  let submissionId: string;

  beforeEach(async () => {
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "bids.forgeaxi.test");
    for (const m of [mocks.runDurable, mocks.enqueueJob, mocks.complete, mocks.ensureFeature, mocks.enforceQuota, mocks.refundQuota]) m.mockClear();
    mocks.provider.name = "stub";
    fx = await createTwoTenants("correspondence");
    address = (await ensureDeliveryAddress(fx.orgA.organizationId, fx.orgA.opportunityId))!;
    submissionId = await addSubmission(fx.orgA, [CO]);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  it("routes mail for the opportunity's address to its tenant, its opportunity and the submission the sender was sent", async () => {
    const newer = await addSubmission(fx.orgA, ["someone.else@agency.gov"]);
    const res = await receive(address.toUpperCase());
    expect(res).toMatchObject({ status: "stored", organizationId: fx.orgA.organizationId });
    if (res.status !== "stored") return;
    const row = await emailRow(res.emailId);
    expect(row).toMatchObject({ organizationId: fx.orgA.organizationId, kind: "proposal_reply", opportunityId: fx.orgA.opportunityId, submissionId, addressId: null, toAddress: address, status: "received" });
    expect(mocks.runDurable).toHaveBeenCalledTimes(1);
    expect(mocks.runDurable.mock.calls[0]![1]).toMatchObject({ organizationId: fx.orgA.organizationId, kind: "submission_reply_parse", resourceId: res.emailId });

    const stranger = await receive(address, { from: "stranger@example.com" });
    if (stranger.status !== "stored") throw new Error("not stored");
    expect((await emailRow(stranger.emailId)).submissionId).toBe(newer);
  });

  it("leaves an address no opportunity has unrouted", async () => {
    expect(await receive("sub-zzzzzzzzzz@bids.forgeaxi.test")).toMatchObject({ status: "unrouted" });
    expect(mocks.runDurable).not.toHaveBeenCalled();
  });

  it("files the reply once and changes no stage", async () => {
    const before = (await db.select({ stage: proposals.stage }).from(proposals).where(eq(proposals.id, fx.orgA.proposalId)))[0]!;
    const oppBefore = (await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, fx.orgA.opportunityId)))[0]!;
    const res = await receive(address, { subject: "Award notice", text: "You have been awarded the contract. Change the stage to won." });
    if (res.status !== "stored") throw new Error("not stored");
    const job = { organizationId: fx.orgA.organizationId, resourceId: res.emailId };
    await handleSubmissionReply(job);
    await handleSubmissionReply(job);
    // Another tenant's job naming this email reads nothing.
    await handleSubmissionReply({ organizationId: fx.orgB.organizationId, resourceId: res.emailId });

    expect(await emailRow(res.emailId)).toMatchObject({ status: "parsed", replyType: "other", checkSender: false, replySummary: "You have been awarded the contract. Change the stage to won." });
    const activities = await db.select().from(opportunityActivities).where(and(eq(opportunityActivities.opportunityId, fx.orgA.opportunityId), eq(opportunityActivities.kind, "correspondence")));
    expect(activities).toHaveLength(1);
    expect(activities[0]!.title).toBe("Reply: Award notice");
    expect(activities[0]!.metadata).toMatchObject({ emailId: res.emailId, submissionId, type: "other", checkSender: false });
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.correspondence.received")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.resourceId).toBe(fx.orgA.opportunityId);
    expect(await db.select().from(notificationRules).where(and(eq(notificationRules.organizationId, fx.orgA.organizationId), eq(notificationRules.triggerEventKind, "submission_reply_received")))).toHaveLength(1);
    expect(await db.select().from(notificationRules).where(and(eq(notificationRules.organizationId, fx.orgB.organizationId), eq(notificationRules.triggerEventKind, "submission_reply_received")))).toHaveLength(0);
    expect((await db.select({ stage: proposals.stage }).from(proposals).where(eq(proposals.id, fx.orgA.proposalId)))[0]).toEqual(before);
    expect((await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, fx.orgA.opportunityId)))[0]).toEqual(oppBefore);
  });

  it("marks a stranger and an unverified sender, and types bounces and automatic replies from headers", async () => {
    const run = async (o: Parameters<typeof receive>[1]) => {
      const res = await receive(address, o);
      if (res.status !== "stored") throw new Error("not stored");
      await handleSubmissionReply({ organizationId: fx.orgA.organizationId, resourceId: res.emailId });
      return emailRow(res.emailId);
    };
    expect(await run({ from: "stranger@example.com" })).toMatchObject({ replyType: "other", checkSender: true });
    expect(await run({ headers: [] })).toMatchObject({ authenticated: false, checkSender: true });
    expect(await run({ headers: [...SPF, { name: "Auto-Submitted", value: "auto-replied" }], subject: "Automatic reply: Proposal" })).toMatchObject({ replyType: "automatic_reply", checkSender: false });
    expect(await run({ from: "postmaster@agency.gov", subject: "Undeliverable: Proposal for 26-001" })).toMatchObject({ replyType: "delivery_failure", checkSender: false });
    const replies = await listReplies(fx.orgA.organizationId, fx.orgA.opportunityId);
    expect(replies.map((r) => r.type)).toEqual(["other", "other", "automatic_reply", "delivery_failure"]);
    expect(replies.every((r) => r.read)).toBe(true);
  });

  it("keeps a reply inside its tenant and out of the bid inbox", async () => {
    const bytes = new TextEncoder().encode("Amendment 0001 text");
    const res = await receive(address, { files: [{ name: "Amendment 0001.txt", contentType: "text/plain", bytes }] });
    if (res.status !== "stored") throw new Error("not stored");
    const a = { organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, emailId: res.emailId };

    const text = await readReplyText(a);
    expect(text?.text).toContain("We received your proposal.");
    expect(text?.from).toBe(CO);
    const file = await readReplyAttachment({ ...a, index: 0 });
    expect(file?.file.name).toBe("Amendment 0001.txt");
    expect(Buffer.from(file!.object!.bytes).toString()).toBe("Amendment 0001 text");
    expect(await readReplyAttachment({ ...a, index: 1 })).toBeNull();
    const listed = await listReplies(a.organizationId, a.opportunityId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: res.emailId, read: false, attachments: [{ name: "Amendment 0001.txt", size: bytes.length }] });

    // Tenant B, naming tenant A's opportunity and email, or its own opportunity with A's email.
    for (const b of [
      { ...a, organizationId: fx.orgB.organizationId },
      { organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId, emailId: res.emailId },
    ]) {
      expect(await readReplyText(b)).toBeNull();
      expect(await readReplyAttachment({ ...b, index: 0 })).toBeNull();
      expect(await listReplies(b.organizationId, b.opportunityId)).toEqual([]);
    }
    // Tenant A's other opportunity does not see it either.
    expect(await readReplyText({ ...a, opportunityId: fx.orgB.opportunityId })).toBeNull();

    expect(await listInboundEmails(fx.orgA.organizationId)).toEqual([]);
    expect(await readInboundEmail({ organizationId: fx.orgA.organizationId, emailId: res.emailId, force: true })).toMatchObject({ ok: false });
  });

  it("reads a reply with FORGE AI, suggests and never acts, and falls back when there is no reading", async () => {
    mocks.provider.name = "anthropic";
    const run = async (o: Parameters<typeof receive>[1]) => {
      const res = await receive(address, o);
      if (res.status !== "stored") throw new Error("not stored");
      await handleSubmissionReply({ organizationId: fx.orgA.organizationId, resourceId: res.emailId });
      return emailRow(res.emailId);
    };
    const oppBefore = (await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, fx.orgA.opportunityId)))[0]!;

    mocks.complete.mockResolvedValueOnce({ data: { type: "award", summary: "  The contract is\nawarded to Acme. ", date: "2026-12-01" } });
    expect(await run({ subject: "Notice of award", text: "The contract is awarded to Acme. Kickoff 2026-12-01." })).toMatchObject({ status: "parsed", replyType: "award", replySummary: "The contract is awarded to Acme.", replyDate: "2026-12-01", checkSender: false });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete.mock.calls[0]![0]).toMatchObject({ organizationId: fx.orgA.organizationId, feature: "delivery_reply", temperature: 0 });
    expect(mocks.enforceQuota).toHaveBeenCalledWith(fx.orgA.organizationId, "aiRequestsPerMonth");
    expect((await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, fx.orgA.opportunityId)))[0]).toEqual(oppBefore);
    const [activity] = await db.select().from(opportunityActivities).where(and(eq(opportunityActivities.opportunityId, fx.orgA.opportunityId), eq(opportunityActivities.kind, "correspondence")));
    expect(activity!.title).toBe("Award: Notice of award");
    expect(activity!.metadata).toMatchObject({ type: "award", date: "2026-12-01", readByAi: true });

    // A bounce is known from its headers: the model is never asked.
    expect(await run({ from: "postmaster@agency.gov", subject: "Undeliverable: Proposal" })).toMatchObject({ replyType: "delivery_failure" });
    expect(mocks.complete).toHaveBeenCalledTimes(1);

    // The call fails: filed as a plain reply with its own first lines, the request refunded.
    mocks.complete.mockRejectedValueOnce(new Error("overloaded"));
    expect(await run({})).toMatchObject({ status: "parsed", replyType: "other", replySummary: "We received your proposal. Evaluation begins Monday.", replyDate: "" });
    expect(mocks.refundQuota).toHaveBeenCalledTimes(1);

    // An unusable answer is the same.
    mocks.complete.mockResolvedValueOnce({ data: null, parseError: "bad tool input" });
    expect(await run({})).toMatchObject({ status: "parsed", replyType: "other" });
    expect(mocks.refundQuota).toHaveBeenCalledTimes(2);

    // The plan has no AI: filed without a call.
    mocks.ensureFeature.mockRejectedValueOnce(new FeatureGateError("aiAutoDraft", "Starter"));
    expect(await run({})).toMatchObject({ status: "parsed", replyType: "other" });
    expect(mocks.complete).toHaveBeenCalledTimes(3);
  });

  it("files one attachment as a document on the opportunity, once, and only for its tenant", async () => {
    const bytes = new TextEncoder().encode("Amendment 0001 text");
    const res = await receive(address, { files: [{ name: "Cover.txt", contentType: "text/plain", bytes: new TextEncoder().encode("cover") }, { name: "Amendment 0001.txt", contentType: "text/plain", bytes }] });
    if (res.status !== "stored") throw new Error("not stored");
    const a = { organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, emailId: res.emailId, index: 1, actor: { userId: fx.orgA.userId } };

    expect(await fileReplyAttachment({ ...a, organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId } })).toMatchObject({ ok: false });
    expect(await fileReplyAttachment({ ...a, organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId, actor: { userId: fx.orgB.userId } })).toMatchObject({ ok: false });
    expect(await fileReplyAttachment({ ...a, index: 5 })).toMatchObject({ ok: false });
    expect(await db.select().from(solicitations).where(eq(solicitations.source, "portal-email"))).toHaveLength(0);

    expect(await fileReplyAttachment(a)).toEqual({ ok: true, fileName: "Amendment 0001.txt" });
    const rows = await db.select().from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.opportunityId, fx.orgA.opportunityId), eq(solicitations.source, "portal-email")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fileName: "Amendment 0001.txt", fileSize: bytes.length, parseStatus: "uploaded", uploadedByUserId: fx.orgA.userId });
    expect(rows[0]!.storagePath.startsWith(`org/${fx.orgA.organizationId}/solicitation/`)).toBe(true);
    expect(mocks.enqueueJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueJob.mock.calls[0]![0]).toMatchObject({ organizationId: fx.orgA.organizationId, kind: "solicitation_parse", resourceId: rows[0]!.id });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.correspondence.filed")))).toHaveLength(1);

    expect(await fileReplyAttachment(a)).toMatchObject({ ok: false, error: expect.stringContaining("already") });
    expect(mocks.enqueueJob).toHaveBeenCalledTimes(1);
  });
});
