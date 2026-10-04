"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { revokeAllApiTokens, revokeApiToken } from "@/lib/api-tokens";
import { validateRevokeReason } from "@/lib/api-tokens-logic";

/**
 * BL-16 API Slice 2a — a platform admin revokes one or all of a tenant's
 * API tokens from /admin/orgs/[id] (a leaked token, a compromised
 * integration). Like the add-on actions, the target tenant is a
 * parameter because the superadmin acts on another organization;
 * requireSuperadmin() gates both. The reason lands in the tenant's audit
 * log, and the tenant's Settings → API access shows "FORGE support" as
 * the revoker.
 */

async function tenantExists(organizationId: string): Promise<boolean> {
  if (!organizationId) return false;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return !!org;
}

export async function adminRevokeApiTokenAction(input: {
  organizationId: string;
  tokenId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const reason = validateRevokeReason(input.reason);
  if (!reason.ok) return reason;
  if (!input.tokenId || !(await tenantExists(input.organizationId))) return { ok: false, error: "Organization or token not found." };
  const res = await revokeApiToken({
    organizationId: input.organizationId,
    tokenId: input.tokenId,
    actor: { userId: actor.id, email: actor.email ?? null },
    platformReason: reason.value,
  });
  if (!res.ok) return res;
  revalidatePath(`/admin/orgs/${input.organizationId}`);
  revalidatePath("/settings/api");
  return { ok: true };
}

export async function adminRevokeAllApiTokensAction(input: {
  organizationId: string;
  reason: string;
}): Promise<{ ok: true; revoked: number } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const reason = validateRevokeReason(input.reason);
  if (!reason.ok) return reason;
  if (!(await tenantExists(input.organizationId))) return { ok: false, error: "Organization not found." };
  const res = await revokeAllApiTokens({
    organizationId: input.organizationId,
    actor: { userId: actor.id, email: actor.email ?? null },
    reason: reason.value,
  });
  revalidatePath(`/admin/orgs/${input.organizationId}`);
  revalidatePath("/settings/api");
  return res;
}
