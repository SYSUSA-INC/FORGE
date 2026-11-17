import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboundEmails, opportunityActivities, proposalSubmissions } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { canAnswer, replySubject, threadHeaders } from "@/lib/correspondence-logic";
import { canSubmit, parseRecipients, SEND_MAX_BYTES, SEND_MAX_FILES, type SubmissionFile, uploadedFileName } from "@/lib/deliver-logic";
import { ensureDeliveryAddress } from "@/lib/deliver-send";
import { proposalOf, sendConfigured, type DeliverUser } from "@/lib/deliver-store";
import { runDurable } from "@/lib/jobs";
import { claimUpload, finishClaim, releaseClaim } from "@/lib/uploads";

/**
 * BL-NAV-LIFECYCLE 6d-1 (FORGE II S-4, Answering) — Reply from the
 * portal. An answer to a message in the Correspondence list goes to that
 * message's sender from the opportunity's own address, in the same
 * thread. It is kept as a `proposal_submission` row of method
 * portal_email with `inReplyToEmailId` set, and sent by the
 * `submission_send` job like a submission, but it is not one: it
 * carries no proposal file, passes no sign-off gate, and when it has
 * left it is filed with `markReplied`, never `markDelivered` (no stage
 * moves, no proposal_submitted event). The same people may answer as
 * may submit. Design: docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.5.
 */

const NOT_SET_UP = "Sending from FORGE is not set up. Answer from your own mail.";

export type SendReplyInput = {
  organizationId: string;
  opportunityId: string;
  user: DeliverUser;
  /** The filed message being answered. */
  emailId: string;
  /** Others to copy: addresses separated by commas or spaces. */
  cc: string;
  ccSender: boolean;
  /** Empty for the message's own subject with "RE:". */
  subject: string;
  body: string;
  /** Files to attach, uploaded with `uploadFile()` and named here. */
  uploads?: { uploadId: string; fileName: string }[];
};

export type SendReplyResult = { ok: true; submissionId: string } | { ok: false; error: string };

export async function queueReplySend(input: SendReplyInput): Promise<SendReplyResult> {
  const { organizationId, opportunityId, user } = input;
  if (!sendConfigured()) return { ok: false, error: NOT_SET_UP };
  // The message is read through the tenant and the opportunity: another tenant's, or another opportunity's, is not found.
  const [email] = await db
    .select({ id: inboundEmails.id, fromAddress: inboundEmails.fromAddress, subject: inboundEmails.subject, status: inboundEmails.status, replyType: inboundEmails.replyType })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, input.emailId), eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.opportunityId, opportunityId), eq(inboundEmails.kind, "proposal_reply")))
    .limit(1);
  if (!email) return { ok: false, error: "This message is no longer available." };
  const proposal = await proposalOf(organizationId, opportunityId);
  if (!proposal) return { ok: false, error: "This opportunity has no proposal." };
  if (!canSubmit(user, proposal)) return { ok: false, error: "Only an org admin, the proposal manager or the capture manager can answer from FORGE." };
  if (!canAnswer(email.replyType)) return { ok: false, error: "This is a mail system's notice that a message was not delivered. There is no one to answer." };

  // The answer goes to whoever wrote the message; the address is the stored one, never typed.
  const to = parseRecipients(email.fromAddress);
  if (!to.ok || to.list.length !== 1) return { ok: false, error: "The sender's address cannot be answered. Answer from your own mail." };
  const cc = parseRecipients([input.cc, input.ccSender ? (user.email ?? "") : ""].join(" "));
  if (!cc.ok) return cc;
  const ccList = cc.list.filter((a) => !to.list.includes(a));
  const subject = replySubject(String(input.subject ?? "").trim() || email.subject);
  const body = String(input.body ?? "").trim().slice(0, 10_000);
  if (!body) return { ok: false, error: "Write the answer." };
  const uploads = Array.isArray(input.uploads) ? input.uploads : [];
  if (uploads.length > SEND_MAX_FILES) return { ok: false, error: `At most ${SEND_MAX_FILES} files.` };
  const address = await ensureDeliveryAddress(organizationId, opportunityId);
  if (!address) return { ok: false, error: NOT_SET_UP };

  const submissionId = randomUUID();
  const files: SubmissionFile[] = [];
  const claims: { uploadId: string; claimedAt: Date }[] = [];
  const refuse = async (error: string): Promise<SendReplyResult> => {
    for (const c of claims) await releaseClaim({ organizationId, uploadId: c.uploadId, claimedAt: c.claimedAt });
    return { ok: false, error };
  };
  for (const u of uploads) {
    const claim = await claimUpload({ organizationId, userId: user.id, uploadId: String(u?.uploadId ?? ""), resourceType: "submission_file", resourceId: submissionId });
    if (!claim.ok) return refuse(claim.error);
    if ("alreadyClaimed" in claim) return refuse("One of the uploaded files was already used. Upload it again.");
    claims.push({ uploadId: claim.claim.uploadId, claimedAt: claim.claim.claimedAt });
    const fileName = uploadedFileName(String(u?.fileName ?? ""), claim.claim.fileName);
    if (files.some((f) => f.fileName.toLowerCase() === fileName.toLowerCase())) return refuse(`Two files are named “${fileName}”. Give each its own name.`);
    files.push({ kind: "extra", renderId: null, fileName, storagePath: claim.claim.storageKey, contentType: claim.claim.contentType, byteSize: claim.claim.size, sha256: "" });
  }
  if (files.reduce((n, f) => n + f.byteSize, 0) > SEND_MAX_BYTES) return refuse("The files are over 35 MB together, which most mail systems refuse.");

  await db.insert(proposalSubmissions).values({
    id: submissionId,
    organizationId,
    opportunityId,
    proposalId: proposal.id,
    method: "portal_email",
    status: "sending",
    recipientsTo: to.list,
    recipientsCc: ccList,
    subject,
    body,
    fromAddress: address,
    replyAddress: address,
    files,
    sentByUserId: user.id,
    inReplyToEmailId: email.id,
  });
  for (const c of claims) await finishClaim({ organizationId, uploadId: c.uploadId, claimedAt: c.claimedAt });
  await runDurable("[deliver] reply", { organizationId, kind: "submission_send", resourceId: submissionId, requestedByUserId: user.id });
  return { ok: true, submissionId };
}

/** The thread headers of an answer, from the message it answers; none when FORGE holds no Message-ID for it. */
export async function replyThreadHeaders(organizationId: string, emailId: string): Promise<Record<string, string> | undefined> {
  const [email] = await db
    .select({ messageId: inboundEmails.providerMessageId })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, emailId), eq(inboundEmails.organizationId, organizationId)))
    .limit(1);
  return (email && threadHeaders(email.messageId)) || undefined;
}

/**
 * An answer has left: it goes on the opportunity's timeline as
 * correspondence and into the audit log. Nothing else: the proposal and
 * the opportunity stay at their stage and no event is raised.
 */
export async function markReplied(r: {
  organizationId: string;
  opportunityId: string;
  submissionId: string;
  emailId: string;
  actor: { userId: string | null; email?: string | null };
  recipients: string[];
  cc: string[];
  from: string;
  subject: string;
  messageId: string;
  threaded: boolean;
  files: SubmissionFile[];
}): Promise<void> {
  await db.insert(opportunityActivities).values({
    opportunityId: r.opportunityId,
    userId: r.actor.userId,
    kind: "correspondence",
    title: `Reply sent: ${r.subject}`.slice(0, 300),
    body: `To ${r.recipients.join(", ")}`,
    metadata: { submissionId: r.submissionId, emailId: r.emailId, direction: "out", attachments: r.files.length },
  });
  await recordAudit({
    organizationId: r.organizationId,
    actor: r.actor,
    action: "opportunity.correspondence.replied",
    resourceType: "opportunity",
    resourceId: r.opportunityId,
    metadata: {
      submissionId: r.submissionId,
      emailId: r.emailId,
      recipients: r.recipients,
      cc: r.cc,
      from: r.from,
      subject: r.subject,
      messageId: r.messageId,
      threaded: r.threaded,
      files: r.files.map((f) => ({ fileName: f.fileName, byteSize: f.byteSize, sha256: f.sha256 })),
    },
  });
}
