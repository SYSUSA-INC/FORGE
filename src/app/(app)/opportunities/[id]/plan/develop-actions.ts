"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { freezePlan, moveToDevelop, unfreezePlan } from "@/lib/plan-freeze-store";

type Result = { ok: true } | { ok: false; error: string };

async function who() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return { organizationId, actor: { userId: actor.id, email: actor.email, name: actor.name } };
}

function refresh(opportunityId: string) {
  revalidatePath("/");
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/plan`);
  revalidatePath("/pipeline/plan");
  revalidatePath("/pipeline/develop");
}

/** BL-NAV-LIFECYCLE 4c-2 — stamp the compliance matrix and the outline. */
export async function freezePlanAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const opportunityId = String(input?.opportunityId ?? "");
  const res = await freezePlan({ organizationId, opportunityId, actor });
  if (res.ok) refresh(opportunityId);
  return res;
}

export async function unfreezePlanAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const opportunityId = String(input?.opportunityId ?? "");
  const res = await unfreezePlan({ organizationId, opportunityId, actor });
  if (res.ok) refresh(opportunityId);
  return res;
}

/** Move to Develop (P-8): writes the plan decision and moves the stage. */
export async function moveToDevelopAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const opportunityId = String(input?.opportunityId ?? "");
  const res = await moveToDevelop({ organizationId, opportunityId, actor });
  if (res.ok) refresh(opportunityId);
  return res;
}
