import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, organizations, proposalPdfRenders, proposalSubmissions, users, type BackgroundJob, type ProposalSubmissionFile } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  attachmentFileName,
  deliveryLocalPart,
  parseRecipients,
  plainBodyHtml,
  SEND_MAX_BYTES,
  SEND_MAX_FILES,
  sendFromHeader,
  snapshotOf,
  uploadedFileName,
} from "@/lib/deliver-logic";
import { auditGateOverride, markDelivered, rendersOf, sendConfigured, submissionContext, type DeliverUser } from "@/lib/deliver-store";
import { EmailRefusedError, sendEmailTracked } from "@/lib/email";
import { inboundDomain } from "@/lib/inbound-email-logic";
import { runDurable } from "@/lib/jobs";
import { JobPermanentError } from "@/lib/jobs-policy";
import { getStorageProvider } from "@/lib/storage";
import { claimUpload, finishClaim, releaseClaim } from "@/lib/uploads";

/**
 * BL-NAV-LIFECYCLE 6b (FORGE II S-3) — Send from FORGE. The lead fills
 * the form; `queueSubmissionSend` checks it against the same gate and
 * permission as Record submission, writes the submission as `sending`
 * and starts the `submission_send` job. The job keeps a copy of each
 * file, sends the message once (the provider call carries the row's id
 * as its idempotency key, so a retried job cannot send twice), then
 * marks the row `sent` and delivery through `markDelivered`; a refusal
 * marks it `failed` with the provider's reason and the lead sends again
 * by hand. Design: docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.4.
 */

const NOT_SET_UP = "Sending from FORGE is not set up. Send the file yourself and use Record submission.";
const TOO_LARGE = "The files are over 35 MB together, which most mail systems refuse. Send them yourself and use Record submission.";

/**
 * The opportunity's own address on the inbound domain: made the first
 * time it is needed, kept for the opportunity's life. Null when the
 * domain is not set or the opportunity is not the tenant's.
 */
export async function ensureDeliveryAddress(organizationId: string, opportunityId: string): Promise<string | null> {
  const domain = inboundDomain();
  if (!domain) return null;
  for (let pass = 0; pass < 3; pass++) {
    const [row] = await db
      .select({ local: opportunities.deliveryLocalPart })
      .from(opportunities)
      .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
      .limit(1);
    if (!row) return null;
    if (row.local) return `${row.local}@${domain}`;
    // Only an empty column is filled, so two sends at once agree on one address; a
    // collision with another opportunity's (unique index) throws and the next pass draws again.
    await db
      .update(opportunities)
      .set({ deliveryLocalPart: deliveryLocalPart(randomBytes(32)) })
      .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId), isNull(opportunities.deliveryLocalPart)))
      .catch(() => undefined);
  }
  return null;
}

export type SendSubmissionInput = {
  organizationId: string;
  opportunityId: string;
  user: DeliverUser;
  /** Addresses separated by commas or spaces. */
  to: string;
  cc: string;
  /** Copy the sender, so the team holds what left and the officer sees a person. */
  ccSender: boolean;
  subject: string;
  body: string;
  /** The kept renders to attach, each under the name the lead gave it. */
  files: { renderId: string; fileName: string }[];
  /** 6b-2 — other files to attach (a signed form), uploaded with `uploadFile()` and named here. */
  uploads?: { uploadId: string; fileName: string }[];
  overrideReason?: string;
};

export type SendSubmissionResult = { ok: true; submissionId: string; overridden: boolean } | { ok: false; error: string };

export async function queueSubmissionSend(input: SendSubmissionInput): Promise<SendSubmissionResult> {
  const { organizationId, opportunityId, user } = input;
  if (!sendConfigured()) return { ok: false, error: NOT_SET_UP };
  const ctx = await submissionContext({ organizationId, opportunityId, user, overrideReason: input.overrideReason, verb: "send" });
  if (!ctx.ok) return ctx;
  const { proposal, gate, overridden, reason } = ctx;

  const to = parseRecipients(input.to);
  if (!to.ok) return to;
  if (to.list.length === 0) return { ok: false, error: "Enter the address the proposal goes to." };
  const cc = parseRecipients([input.cc, input.ccSender ? (user.email ?? "") : ""].join(" "));
  if (!cc.ok) return cc;
  const ccList = cc.list.filter((a) => !to.list.includes(a));
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!subject) return { ok: false, error: "Enter a subject." };
  const body = String(input.body ?? "").trim().slice(0, 10_000);
  if (!body) return { ok: false, error: "Write the message that goes with the files." };

  const chosen = Array.isArray(input.files) ? input.files : [];
  if (chosen.length === 0) return { ok: false, error: "Choose at least one file to send." };
  const uploads = Array.isArray(input.uploads) ? input.uploads : [];
  if (chosen.length + uploads.length > SEND_MAX_FILES) return { ok: false, error: `At most ${SEND_MAX_FILES} files.` };
  const renders = await rendersOf(organizationId, proposal.id);
  const submissionId = randomUUID();
  const files: ProposalSubmissionFile[] = [];
  for (const c of chosen) {
    const render = renders.find((r) => r.id === String(c?.renderId ?? ""));
    if (!render) return { ok: false, error: "One of the chosen files is not a render of this proposal. Choose the files again." };
    if (files.some((f) => f.renderId === render.id)) return { ok: false, error: "The same file is chosen twice." };
    const fileName = attachmentFileName(String(c?.fileName ?? ""), proposal.title, render.contentType);
    if (files.some((f) => f.fileName.toLowerCase() === fileName.toLowerCase())) return { ok: false, error: `Two files are named “${fileName}”. Give each its own name.` };
    // The copy and its SHA-256 are made by the job, from the bytes it attaches.
    files.push({ renderId: render.id, fileName, storagePath: `org/${organizationId}/submission/${submissionId}/${fileName}`, contentType: render.contentType, byteSize: render.byteSize, sha256: "" });
  }
  const address = await ensureDeliveryAddress(organizationId, opportunityId);
  if (!address) return { ok: false, error: NOT_SET_UP };

  // The uploaded extras are claimed last, so a refusal above leaves them free to use again.
  const claims: { uploadId: string; claimedAt: Date }[] = [];
  const refuse = async (error: string): Promise<SendSubmissionResult> => {
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
  if (files.reduce((n, f) => n + f.byteSize, 0) > SEND_MAX_BYTES) return refuse(TOO_LARGE);

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
    signoff: snapshotOf(gate),
    overrideReason: reason,
    sentByUserId: user.id,
  });
  for (const c of claims) await finishClaim({ organizationId, uploadId: c.uploadId, claimedAt: c.claimedAt });
  await auditGateOverride({ organizationId, opportunityId, submissionId, actor: { userId: user.id, email: user.email }, ctx });
  await runDurable("[deliver] send", { organizationId, kind: "submission_send", resourceId: submissionId, requestedByUserId: user.id });
  return { ok: true, submissionId, overridden };
}

/** The `submission_send` job: keep the files, send once, mark delivery. */
export async function handleSubmissionSend(job: BackgroundJob): Promise<void> {
  const organizationId = job.organizationId;
  const [row] = await db
    .select()
    .from(proposalSubmissions)
    .where(and(eq(proposalSubmissions.id, job.resourceId), eq(proposalSubmissions.organizationId, organizationId)))
    .limit(1);
  // Only a row still `sending` is sent: a sent or failed one is never sent again.
  if (!row || row.status !== "sending") return;
  const [[org], [sender]] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    row.sentByUserId ? db.select({ email: users.email }).from(users).where(eq(users.id, row.sentByUserId)).limit(1) : Promise.resolve([]),
  ]);
  const actor = { userId: row.sentByUserId, email: sender?.email ?? null };

  const fail = async (error: string): Promise<never> => {
    const message = error.slice(0, 1000);
    await db.update(proposalSubmissions).set({ status: "failed", error: message, updatedAt: new Date() }).where(and(eq(proposalSubmissions.id, row.id), eq(proposalSubmissions.organizationId, organizationId), eq(proposalSubmissions.status, "sending")));
    await recordAudit({
      organizationId,
      actor,
      action: "proposal.submission.send_failed",
      resourceType: "proposal",
      resourceId: row.proposalId,
      metadata: { submissionId: row.id, opportunityId: row.opportunityId, error: message },
    });
    throw new JobPermanentError(message);
  };

  if (!sendConfigured() || !row.fromAddress) await fail(NOT_SET_UP);

  const storage = getStorageProvider();
  const files: ProposalSubmissionFile[] = [];
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  for (const f of row.files ?? []) {
    // A retried job finds the copy it already made; an uploaded extra is already at its own key.
    let object = await storage.get(f.storagePath);
    if (!object) {
      const [render] = f.renderId
        ? await db
            .select({ storagePath: proposalPdfRenders.storagePath })
            .from(proposalPdfRenders)
            .where(and(eq(proposalPdfRenders.id, f.renderId), eq(proposalPdfRenders.organizationId, organizationId)))
            .limit(1)
        : [];
      object = render ? await storage.get(render.storagePath) : null;
      if (!object) await fail(`“${f.fileName}” is no longer in storage. Render the proposal again and send the new file.`);
      await storage.put({ key: f.storagePath, bytes: object!.bytes, contentType: object!.contentType });
    }
    const bytes = object!.bytes;
    files.push({ ...f, contentType: object!.contentType, byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
    attachments.push({ filename: f.fileName, content: Buffer.from(bytes), contentType: object!.contentType });
  }
  if (files.length === 0) await fail("The submission has no file.");
  if (files.reduce((n, f) => n + f.byteSize, 0) > SEND_MAX_BYTES) await fail(TOO_LARGE);
  await db.update(proposalSubmissions).set({ files, updatedAt: new Date() }).where(and(eq(proposalSubmissions.id, row.id), eq(proposalSubmissions.organizationId, organizationId)));

  let messageId = "";
  try {
    const res = await sendEmailTracked({
      to: row.recipientsTo,
      cc: row.recipientsCc,
      from: sendFromHeader(org?.name ?? "", row.fromAddress),
      replyTo: row.replyAddress || row.fromAddress,
      subject: row.subject,
      text: row.body,
      html: plainBodyHtml(row.body),
      attachments,
      idempotencyKey: `submission-send/${row.id}`,
    });
    // A stubbed send left nothing: never mark it sent.
    if (res.stubbed) await fail(NOT_SET_UP);
    else messageId = res.id;
  } catch (err) {
    if (err instanceof JobPermanentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // A refusal is final. Anything else (the network) is tried again under the same key, until the attempts are spent.
    if (err instanceof EmailRefusedError || job.attempts >= job.maxAttempts) await fail(message);
    throw err;
  }

  const now = new Date();
  const landed = await db
    .update(proposalSubmissions)
    .set({ status: "sent", messageId, error: "", sentAt: now, updatedAt: now })
    .where(and(eq(proposalSubmissions.id, row.id), eq(proposalSubmissions.organizationId, organizationId), eq(proposalSubmissions.status, "sending")))
    .returning({ id: proposalSubmissions.id });
  if (landed.length === 0) return;
  await markDelivered({
    organizationId,
    opportunityId: row.opportunityId,
    submissionId: row.id,
    proposalId: row.proposalId,
    actor,
    method: "portal_email",
    sentAt: now,
    now,
    recipients: row.recipientsTo,
    note: row.subject,
    files,
    overridden: row.overrideReason !== "",
    auditAction: "proposal.submission.sent",
    auditMetadata: {
      cc: row.recipientsCc,
      from: row.fromAddress,
      subject: row.subject,
      messageId,
      files: files.map((f) => ({ kind: f.kind ?? "proposal", renderId: f.renderId, fileName: f.fileName, byteSize: f.byteSize, sha256: f.sha256 })),
    },
  });
}
