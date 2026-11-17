import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboundEmails, notificationRules, opportunities, opportunityActivities, proposalSubmissions, proposals } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  headerReplyType,
  isReplyLocalPart,
  needsSenderCheck,
  pickSubmission,
  REPLY_TEXT_MAX,
  replySummary,
  replyTypeLabel,
  senderIsRecipient,
  type ReplyType,
} from "@/lib/correspondence-logic";
import { companyLocalPart, emailText, inboundMessageSchema, type InboundMessage } from "@/lib/inbound-email-logic";
import { runDurable } from "@/lib/jobs";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { getStorageProvider } from "@/lib/storage";

/**
 * BL-NAV-LIFECYCLE 6c (FORGE II S-4) — replies to a submission, server
 * side. `routeReply` finds the opportunity a message was sent to by its
 * own address; `receiveInboundMessage` (src/lib/inbound-email.ts) keeps
 * the message as an inbound email of kind proposal_reply; the
 * `submission_reply_parse` job reads what it is and files it once: the
 * type and summary on the row, a `correspondence` activity, the audit
 * row and the `submission_reply_received` event. The message is
 * untrusted text: nothing here changes a stage or a proposal. The
 * readers below serve the Deliver tab's Correspondence list; callers
 * own the auth gate. Design:
 * docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.5, §2.7.
 */

export type ReplyRoute = { organizationId: string; opportunityId: string; submissionId: string | null; to: string };

/**
 * The opportunity a message was sent to, from its recipients. The
 * address lookup is the one read across tenants: a `sub-…` local part is
 * a random, unique string, and the row it names gives its own tenant and
 * nothing else (design §2.7). Everything after it is read inside that
 * tenant. Null when no recipient is an opportunity's address.
 */
export async function routeReply(i: { recipients: string[]; from: string; domain: string; mailbox: string | null }): Promise<ReplyRoute | null> {
  for (const r of i.recipients) {
    const local = companyLocalPart(r, { domain: i.domain, mailbox: i.mailbox });
    if (!isReplyLocalPart(local)) continue;
    const [opp] = await db
      .select({ id: opportunities.id, organizationId: opportunities.organizationId })
      .from(opportunities)
      .where(eq(opportunities.deliveryLocalPart, local))
      .limit(1);
    if (!opp) continue;
    const organizationId = opp.organizationId;
    const submissions = await db
      .select({ id: proposalSubmissions.id, status: proposalSubmissions.status, to: proposalSubmissions.recipientsTo, cc: proposalSubmissions.recipientsCc })
      .from(proposalSubmissions)
      .where(and(eq(proposalSubmissions.organizationId, organizationId), eq(proposalSubmissions.opportunityId, opp.id)))
      .orderBy(desc(proposalSubmissions.createdAt))
      .limit(50);
    const submissionId = pickSubmission(submissions.map((s) => ({ id: s.id, status: s.status, to: s.to ?? [], cc: s.cc ?? [] })), i.from);
    return { organizationId, opportunityId: opp.id, submissionId, to: `${local}@${i.domain}` };
  }
  return null;
}

/** Read and file a reply in the background. */
export async function queueReplyRead(organizationId: string, emailId: string): Promise<void> {
  await runDurable("[correspondence] read", { organizationId, kind: "submission_reply_parse", resourceId: emailId });
}

/** A stored reply, from the company's storage. */
async function loadReply(organizationId: string, storagePath: string): Promise<InboundMessage | null> {
  if (!storagePath.startsWith(`org/${organizationId}/inbound/`)) return null;
  const obj = await getStorageProvider().get(storagePath);
  if (!obj) return null;
  const parsed = inboundMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(obj.bytes)));
  return parsed.success ? parsed.data : null;
}

/** A tenant gets the default rule the first time a reply of its arrives: the people named in the event, in the inbox and by email. */
async function ensureReplyDefaultRule(organizationId: string): Promise<void> {
  const [any] = await db
    .select({ id: notificationRules.id })
    .from(notificationRules)
    .where(and(eq(notificationRules.organizationId, organizationId), eq(notificationRules.triggerEventKind, "submission_reply_received")))
    .limit(1);
  if (any) return;
  await db.insert(notificationRules).values({
    organizationId,
    name: "Default: Reply to a submission received",
    description: "When a reply arrives at an opportunity's own address, the proposal manager, the capture manager and the person who sent the submission are told in the inbox and by email.",
    triggerEventKind: "submission_reply_received",
    recipientStrategy: "mentioned_in_payload",
    channels: ["in_app", "email"],
    frequency: "immediate",
  });
}

/**
 * The `submission_reply_parse` job: read one reply and file it, once.
 * The type comes from the headers (a delivery failure, an automatic
 * reply) or is a plain reply; the summary is the reply's own first two
 * lines. The row moves from received to parsed in one conditional
 * update, so a second run of the job files nothing twice.
 */
export async function handleSubmissionReply(job: { organizationId: string; resourceId: string }): Promise<void> {
  const { organizationId } = job;
  const [email] = await db
    .select()
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, job.resourceId), eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.kind, "proposal_reply")))
    .limit(1);
  if (!email || email.status !== "received" || !email.opportunityId) return;
  const opportunityId = email.opportunityId;
  const [submission] = email.submissionId
    ? await db
        .select({ id: proposalSubmissions.id, proposalId: proposalSubmissions.proposalId, to: proposalSubmissions.recipientsTo, cc: proposalSubmissions.recipientsCc, sentByUserId: proposalSubmissions.sentByUserId })
        .from(proposalSubmissions)
        .where(and(eq(proposalSubmissions.id, email.submissionId), eq(proposalSubmissions.organizationId, organizationId)))
        .limit(1)
    : [];
  const payload = await loadReply(organizationId, email.storagePath);
  const type: ReplyType = headerReplyType({ headers: payload?.headers ?? [], from: email.fromAddress, subject: email.subject }) ?? "other";
  const summary = replySummary(payload ? emailText(payload) : email.textPreview);
  const knownSender = senderIsRecipient(email.fromAddress, submission ? { to: submission.to ?? [], cc: submission.cc ?? [] } : null);
  const checkSender = needsSenderCheck({ authenticated: email.authenticated, knownSender, type });

  const claimed = await db
    .update(inboundEmails)
    .set({ status: "parsed", replyType: type, replySummary: summary, checkSender, error: "" })
    .where(and(eq(inboundEmails.id, email.id), eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.status, "received")))
    .returning({ id: inboundEmails.id });
  if (claimed.length === 0) return;

  const sender = email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress;
  const label = replyTypeLabel(type);
  const subject = email.subject || "(no subject)";
  await db.insert(opportunityActivities).values({
    opportunityId,
    userId: null,
    kind: "correspondence",
    title: `${label}: ${subject}`.slice(0, 300),
    body: [`From ${sender}${checkSender ? " (check the sender)" : ""}`, summary].filter(Boolean).join("\n"),
    metadata: { emailId: email.id, submissionId: submission?.id ?? null, type, from: email.fromAddress, checkSender, attachments: (email.attachments ?? []).length },
  });
  await recordAudit({
    organizationId,
    actor: { userId: null },
    action: "opportunity.correspondence.received",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: { emailId: email.id, submissionId: submission?.id ?? null, type, from: email.fromAddress, authenticated: email.authenticated, knownSender, checkSender },
  }).catch((err) => log.warn("[correspondence]", "audit failed", { organizationId, error: err }));

  try {
    const [opp] = await db
      .select({ title: opportunities.title })
      .from(opportunities)
      .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
      .limit(1);
    const [proposal] = submission
      ? await db
          .select({ id: proposals.id, pm: proposals.proposalManagerUserId, capture: proposals.captureManagerUserId })
          .from(proposals)
          .where(and(eq(proposals.id, submission.proposalId), eq(proposals.organizationId, organizationId)))
          .limit(1)
      : [];
    const mentionedUserIds = [...new Set([proposal?.pm, proposal?.capture, submission?.sentByUserId].filter((u): u is string => !!u))];
    await ensureReplyDefaultRule(organizationId);
    await dispatchTriggerEvent({
      organizationId,
      kind: "submission_reply_received",
      payload: { opportunityId, submissionId: submission?.id ?? null, proposalId: proposal?.id ?? null, emailId: email.id, replyType: type, checkSender, mentionedUserIds },
      subject: `${label} on ${opp?.title ?? "an opportunity"}: ${subject}`.slice(0, 300),
      body: [`From ${sender}${checkSender ? ". Check the sender before acting on it." : ""}`, summary].filter(Boolean).join("\n"),
      linkPath: `/opportunities/${opportunityId}/deliver`,
      proposalId: proposal?.id,
    });
  } catch (err) {
    log.warn("[correspondence]", "submission_reply_received dispatch failed", { organizationId, emailId: email.id, error: err });
  }
}

export type DeliverReply = {
  id: string;
  submissionId: string | null;
  fromAddress: string;
  fromName: string;
  subject: string;
  receivedAt: string;
  /** False while the job has not read it yet. */
  read: boolean;
  type: string;
  summary: string;
  checkSender: boolean;
  attachments: { name: string; size: number }[];
};

/** The replies filed to an opportunity, oldest first. */
export async function listReplies(organizationId: string, opportunityId: string): Promise<DeliverReply[]> {
  const rows = await db
    .select({
      id: inboundEmails.id,
      submissionId: inboundEmails.submissionId,
      fromAddress: inboundEmails.fromAddress,
      fromName: inboundEmails.fromName,
      subject: inboundEmails.subject,
      receivedAt: inboundEmails.receivedAt,
      status: inboundEmails.status,
      replyType: inboundEmails.replyType,
      replySummary: inboundEmails.replySummary,
      checkSender: inboundEmails.checkSender,
      attachments: inboundEmails.attachments,
    })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.opportunityId, opportunityId), eq(inboundEmails.kind, "proposal_reply")))
    .orderBy(inboundEmails.receivedAt)
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    submissionId: r.submissionId,
    fromAddress: r.fromAddress,
    fromName: r.fromName,
    subject: r.subject,
    receivedAt: r.receivedAt.toISOString(),
    read: r.status === "parsed",
    type: r.replyType,
    summary: r.replySummary,
    checkSender: r.checkSender,
    attachments: (r.attachments ?? []).map((a) => ({ name: a.name, size: a.size })),
  }));
}

/** One reply's stored message; null when it is not this tenant's, not this opportunity's, or gone from storage. */
async function replyMessage(i: { organizationId: string; opportunityId: string; emailId: string }) {
  const [row] = await db
    .select({ id: inboundEmails.id, storagePath: inboundEmails.storagePath, fromAddress: inboundEmails.fromAddress })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, i.emailId), eq(inboundEmails.organizationId, i.organizationId), eq(inboundEmails.opportunityId, i.opportunityId), eq(inboundEmails.kind, "proposal_reply")))
    .limit(1);
  if (!row) return null;
  const message = await loadReply(i.organizationId, row.storagePath);
  return message ? { row, message } : null;
}

/** A reply's full text, for reading on the Deliver tab. The caller records the read. */
export async function readReplyText(i: { organizationId: string; opportunityId: string; emailId: string }): Promise<{ text: string; truncated: boolean; from: string } | null> {
  const found = await replyMessage(i);
  if (!found) return null;
  const text = emailText(found.message);
  return { text: text.slice(0, REPLY_TEXT_MAX), truncated: text.length > REPLY_TEXT_MAX, from: found.row.fromAddress };
}

/** One attachment of a reply, by its position, for the download route. */
export async function readReplyAttachment(i: { organizationId: string; opportunityId: string; emailId: string; index: number }) {
  const found = await replyMessage(i);
  const file = found?.message.attachments[i.index];
  if (!file || !file.storagePath.startsWith(`org/${i.organizationId}/inbound/${i.emailId}/`)) return null;
  return { file, object: await getStorageProvider().get(file.storagePath) };
}
