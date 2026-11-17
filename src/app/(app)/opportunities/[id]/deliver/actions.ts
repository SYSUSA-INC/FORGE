"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordSubmission, type RecordSubmissionResult } from "@/lib/deliver-store";

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
  revalidatePath("/");
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/deliver`);
  revalidatePath(`/opportunities/${opportunityId}/activity`);
  revalidatePath("/pipeline/develop");
  revalidatePath("/pipeline/deliver");
  revalidatePath("/proposals");
  return res;
}
