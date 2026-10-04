"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { createApiToken, revokeApiToken } from "@/lib/api-tokens";

/**
 * BL-16 apiAccess — org admins create and revoke the workspace's API
 * tokens. The plain token comes back once, from create, and is never
 * readable again.
 */
export async function createApiTokenAction(input: { name: string; expiresInDays: number }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  const res = await createApiToken({
    organizationId,
    name: input.name,
    expiresInDays: input.expiresInDays,
    actor: { userId: actor.id, email: actor.email ?? null },
  });
  if (res.ok) revalidatePath("/settings/api");
  return res;
}

export async function revokeApiTokenAction(tokenId: string) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  const res = await revokeApiToken({ organizationId, tokenId, actor: { userId: actor.id, email: actor.email ?? null } });
  if (res.ok) revalidatePath("/settings/api");
  return res;
}
