"use server";

import { revalidatePath } from "next/cache";
import { recordRead } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { readReplyText } from "@/lib/correspondence";
import { queueSubmissionSend, type SendSubmissionResult } from "@/lib/deliver-send";
import { attachSubmissionReceipt, recordSubmission, type RecordSubmissionResult } from "@/lib/deliver-store";

/**
 * BL-NAV-LIFECYCLE 6a (S-1, S-2) — Record submission: the lead sent the
 * proposal themselves (their own email, a government portal, another
 * way) and records it here. Blocked until every colour team has signed
 * off, unless an org admin or the proposal manager gives a reason. The
 * audit rows (`proposal.submission.recorded`, `.gate_override`) are
 * written by `recordSubmission`.
 */
export async function recordSubmissionAction(input: {
  opportunityId: string;
  method: string;
  sentAt: string;
  recipients: string;
  note: string;
  renderId: string;
  overrideReason?: string;
}): Promise<RecordSubmissionResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const opportunityId = String(input?.opportunityId ?? "");
  const res = await recordSubmission({
    organizationId,
    opportunityId,
    user: { id: actor.id, email: actor.email, name: actor.name, role: actor.role, isSuperadmin: actor.isSuperadmin },
    method: String(input?.method ?? ""),
    sentAt: String(input?.sentAt ?? ""),
    recipients: String(input?.recipients ?? ""),
    note: String(input?.note ?? ""),
    renderId: String(input?.renderId ?? ""),
    overrideReason: input?.overrideReason,
  });
  if (!res.ok) return res;
  revalidateDelivery(opportunityId);
  return res;
}

function revalidateDelivery(opportunityId: string) {
  revalidatePath("/");
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/deliver`);
  revalidatePath(`/opportunities/${opportunityId}/activity`);
  revalidatePath("/pipeline/develop");
  revalidatePath("/pipeline/deliver");
  revalidatePath("/proposals");
}

/**
 * BL-NAV-LIFECYCLE 6b (S-3) — Send from FORGE: the message and the chosen
 * renders go to the contracting officer from the opportunity's own
 * address, once, in a durable job. The same gate, override and permission
 * as Record submission. `queueSubmissionSend` audits an override; the job
 * audits `proposal.submission.sent` or `.send_failed`.
 */
export async function sendSubmissionAction(input: {
  opportunityId: string;
  to: string;
  cc: string;
  ccSender: boolean;
  subject: string;
  body: string;
  files: { renderId: string; fileName: string }[];
  uploads?: { uploadId: string; fileName: string }[];
  overrideReason?: string;
}): Promise<SendSubmissionResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const opportunityId = String(input?.opportunityId ?? "");
  const res = await queueSubmissionSend({
    organizationId,
    opportunityId,
    user: { id: actor.id, email: actor.email, name: actor.name, role: actor.role, isSuperadmin: actor.isSuperadmin },
    to: String(input?.to ?? ""),
    cc: String(input?.cc ?? ""),
    ccSender: input?.ccSender !== false,
    subject: String(input?.subject ?? ""),
    body: String(input?.body ?? ""),
    files: (Array.isArray(input?.files) ? input.files : []).slice(0, 20).map((f) => ({ renderId: String(f?.renderId ?? ""), fileName: String(f?.fileName ?? "") })),
    uploads: (Array.isArray(input?.uploads) ? input.uploads : []).slice(0, 20).map((u) => ({ uploadId: String(u?.uploadId ?? ""), fileName: String(u?.fileName ?? "") })),
    overrideReason: input?.overrideReason,
  });
  if (!res.ok) return res;
  revalidateDelivery(opportunityId);
  return res;
}

/**
 * BL-NAV-LIFECYCLE 6b-2 — attach a receipt to a submission on record. The
 * file was uploaded by the browser with `uploadFile()`; only its upload id
 * arrives here. `attachSubmissionReceipt` audits
 * `proposal.submission.receipt_attached`.
 */
export async function attachReceiptAction(input: { opportunityId: string; submissionId: string; uploadId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const opportunityId = String(input?.opportunityId ?? "");
  const res = await attachSubmissionReceipt({
    organizationId,
    opportunityId,
    submissionId: String(input?.submissionId ?? ""),
    user: { id: actor.id, email: actor.email, name: actor.name, role: actor.role, isSuperadmin: actor.isSuperadmin },
    uploadId: String(input?.uploadId ?? ""),
  });
  if (res.ok) revalidatePath(`/opportunities/${opportunityId}/deliver`);
  return res;
}

/**
 * BL-NAV-LIFECYCLE 6c (S-4) — open a reply filed to the opportunity: its
 * full text, read from the tenant's storage. A read, so nothing is
 * revalidated; it is audited (`opportunity.correspondence.read`).
 */
export async function readReplyAction(input: { opportunityId: string; emailId: string }): Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const opportunityId = String(input?.opportunityId ?? "");
  const emailId = String(input?.emailId ?? "");
  const found = await readReplyText({ organizationId, opportunityId, emailId });
  if (!found) return { ok: false, error: "This message is no longer available." };
  await recordRead({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.correspondence.read",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: { emailId, from: found.from },
  });
  return { ok: true, text: found.text, truncated: found.truncated };
}
