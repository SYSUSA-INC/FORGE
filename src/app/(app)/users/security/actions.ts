"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { resetMemberSecondStep } from "@/lib/company-security";

/**
 * BL-MFA-ADMIN — a company admin resets a member's two-step sign-in, with
 * a written reason. The company comes from the session, never the caller.
 */
export async function resetMemberSecondStepAction(input: { userId: string; reason: string }): Promise<{ ok: true; emailSent: boolean; warning?: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const res = await resetMemberSecondStep({
    organizationId,
    actor: { userId: actor.id, email: actor.email ?? null },
    userId: String(input?.userId ?? ""),
    reason: String(input?.reason ?? ""),
  });
  if (res.ok) revalidatePath("/users/security");
  return res;
}
