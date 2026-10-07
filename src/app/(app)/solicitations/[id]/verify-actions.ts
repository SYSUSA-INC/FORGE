"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  addRequirement,
  clearRequirementReview,
  confirmVerbatimRequirements,
  reviewRequirement,
} from "@/lib/requirement-corrections";

/**
 * BL-AIX Phase 2c — verify and correct a solicitation's extracted
 * requirements. Any member of the organization; every verdict is audited
 * and re-applied whenever the solicitation is parsed again.
 */

type Done = { ok: true } | { ok: false; error: string };

function refresh(solicitationId: string) {
  revalidatePath(`/solicitations/${solicitationId}`);
  revalidatePath(`/solicitations/${solicitationId}/verify`);
}

export async function reviewRequirementAction(input: {
  solicitationId: string;
  docKey: string;
  originalKey: string;
  action: "confirmed" | "edited" | "rejected";
  corrected?: { kind?: string; text?: string; ref?: string };
}): Promise<Done> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!["confirmed", "edited", "rejected"].includes(input.action)) return { ok: false, error: "Unknown verdict." };
  const res = await reviewRequirement({
    organizationId,
    solicitationId: input.solicitationId,
    actor: { userId: user.id, email: user.email },
    docKey: input.docKey,
    originalKey: input.originalKey,
    action: input.action,
    corrected: input.corrected,
  });
  if (res.ok) refresh(input.solicitationId);
  return res;
}

export async function addRequirementAction(input: {
  solicitationId: string;
  kind: string;
  text: string;
  ref: string;
}): Promise<Done> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await addRequirement({
    organizationId,
    solicitationId: input.solicitationId,
    actor: { userId: user.id, email: user.email },
    clause: { kind: input.kind, text: input.text, ref: input.ref },
  });
  if (res.ok) refresh(input.solicitationId);
  return res;
}

export async function undoRequirementReviewAction(input: {
  solicitationId: string;
  docKey: string;
  originalKey: string;
}): Promise<Done> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await clearRequirementReview({
    organizationId,
    solicitationId: input.solicitationId,
    actor: { userId: user.id, email: user.email },
    docKey: input.docKey,
    originalKey: input.originalKey,
  });
  if (res.ok) refresh(input.solicitationId);
  return res;
}

export async function confirmVerbatimRequirementsAction(
  solicitationId: string,
): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await confirmVerbatimRequirements({
    organizationId,
    solicitationId,
    actor: { userId: user.id, email: user.email },
  });
  if (res.ok) refresh(solicitationId);
  return res;
}
