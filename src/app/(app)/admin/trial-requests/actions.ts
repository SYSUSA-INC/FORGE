"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { approveTrialRequest, declineTrialRequest, type ApproveResult } from "@/lib/trial-requests";

/**
 * BL-AUTH-ABUSE Slice 2b — a platform admin decides a trial request.
 * Approving creates the workspace (named after the company), invites the
 * requester as its admin and starts a 14-day trial; declining records an
 * optional internal reason and sends nothing.
 */
export async function approveTrialRequestAction(requestId: string): Promise<ApproveResult> {
  const actor = await requireSuperadmin();
  const res = await approveTrialRequest({
    requestId,
    actor: { id: actor.id, email: actor.email, name: actor.name, organizationId: actor.organizationId },
  });
  revalidatePath("/admin/trial-requests");
  revalidatePath("/admin");
  return res;
}

export async function declineTrialRequestAction(requestId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const res = await declineTrialRequest({
    requestId,
    reason,
    actor: { id: actor.id, email: actor.email, name: actor.name, organizationId: actor.organizationId },
  });
  revalidatePath("/admin/trial-requests");
  revalidatePath("/admin");
  return res;
}
