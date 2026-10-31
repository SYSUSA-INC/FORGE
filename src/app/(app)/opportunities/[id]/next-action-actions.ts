"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { opportunities, opportunityNextActions } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { decideNextAction } from "@/lib/next-action-sync";
import { mayDecideNextAction } from "@/lib/next-actions";

/**
 * BL-NEXT-ACTION phase 5a — a person's Done or Not now on a proposed
 * action. The pursuit's owner, Capture and Admin may decide; everyone
 * sees the panel.
 */
type Result = { ok: true } | { ok: false; error: string };

async function decide(id: string, decision: "done" | "dismissed"): Promise<Result> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select({ ownerUserId: opportunities.ownerUserId })
    .from(opportunityNextActions)
    .innerJoin(opportunities, eq(opportunities.id, opportunityNextActions.opportunityId))
    .where(and(eq(opportunityNextActions.organizationId, organizationId), eq(opportunityNextActions.id, id), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Action not found." };
  if (!mayDecideNextAction(user, row.ownerUserId)) return { ok: false, error: "The pursuit's owner, Capture or Admin can decide this." };
  const res = await decideNextAction({ organizationId, id, decision, actor: { userId: user.id, email: user.email } });
  if (!res.ok) return res;
  revalidatePath(`/opportunities/${res.opportunityId}`);
  if (res.proposalId) revalidatePath(`/proposals/${res.proposalId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function markNextActionDoneAction(input: { id: string }): Promise<Result> {
  return decide(input.id, "done");
}

export async function dismissNextActionAction(input: { id: string }): Promise<Result> {
  return decide(input.id, "dismissed");
}
