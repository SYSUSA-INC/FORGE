"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { addPartnerCandidate, moveToPlan, removePartner, setPartnerStatus } from "@/lib/capture-store";

/**
 * BL-NAV-LIFECYCLE phase 3a — Capture on an opportunity: add a company as
 * a candidate partner, choose / decline / reconsider / remove one, and
 * Move to Plan. The organization comes from the session.
 */
type Result = { ok: true } | { ok: false; error: string };

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/partners`);
  revalidatePath("/pipeline/capture");
}

async function who() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return { organizationId, actor: { userId: actor.id, email: actor.email } };
}

export async function addPartnerAction(input: { opportunityId: string; companyId: string; reason?: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await addPartnerCandidate({ organizationId, opportunityId: String(input?.opportunityId ?? ""), companyId: String(input?.companyId ?? ""), actor, source: "own", reason: String(input?.reason ?? "") });
  if (res.ok) refresh(input.opportunityId);
  return res.ok ? { ok: true } : res;
}

export async function setPartnerStatusAction(input: { opportunityId: string; partnerId: string; status: "chosen" | "declined" | "candidate" }): Promise<Result> {
  const { organizationId, actor } = await who();
  if (!["chosen", "declined", "candidate"].includes(String(input?.status))) return { ok: false, error: "Unknown status." };
  const res = await setPartnerStatus({ organizationId, opportunityId: String(input?.opportunityId ?? ""), partnerId: String(input?.partnerId ?? ""), status: input.status, actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function removePartnerAction(input: { opportunityId: string; partnerId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await removePartner({ organizationId, opportunityId: String(input?.opportunityId ?? ""), partnerId: String(input?.partnerId ?? ""), actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function moveToPlanAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await moveToPlan({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor });
  if (res.ok) {
    refresh(input.opportunityId);
    revalidatePath("/pipeline/plan");
    revalidatePath("/opportunities");
    revalidatePath("/");
  }
  return res;
}
