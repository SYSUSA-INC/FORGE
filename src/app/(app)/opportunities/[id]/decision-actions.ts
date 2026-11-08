"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordDecision } from "@/lib/opportunity-decision-store";

/**
 * BL-NAV-LIFECYCLE phase 2a — GO, NO-GO (with a category and a reason) or
 * PARTNER on an opportunity in Evaluate. Recorded, the stage moved and
 * audited (`opportunity.decision`).
 */
export async function decideOpportunityAction(input: { opportunityId: string; decision: string; category?: string; reason?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await recordDecision({
    organizationId,
    opportunityId: String(input?.opportunityId ?? ""),
    actor: { userId: actor.id, email: actor.email },
    decision: { decision: String(input?.decision ?? ""), category: input?.category ? String(input.category) : undefined, reason: input?.reason ? String(input.reason) : undefined },
  });
  if (!res.ok) return res;
  revalidatePath(`/opportunities/${input.opportunityId}`);
  revalidatePath("/pipeline/evaluate");
  revalidatePath("/pipeline/capture");
  revalidatePath("/opportunities");
  revalidatePath("/");
  return { ok: true };
}
