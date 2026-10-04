"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { grantTenantAddon, revokeTenantAddon } from "@/lib/addons";
import { requireSuperadmin } from "@/lib/auth-helpers";

/**
 * BL-PACKAGES add-ons Slice 1 — a platform admin grants or ends an
 * add-on for one tenant from /admin/orgs/[id]. Like changeTenantTierAction,
 * the target tenant is a parameter because the superadmin acts on
 * another organization; requireSuperadmin() gates both.
 */

export async function grantAddonAction(input: {
  organizationId: string;
  addonId: string;
  quantity: number;
  note: string;
  endsAt: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  if (!input.organizationId || !input.addonId) return { ok: false, error: "Pick an organization and an add-on." };
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
  if (!org) return { ok: false, error: "Organization not found." };
  let endsAt: Date | null = null;
  if (input.endsAt) {
    // A date from <input type="date">: the grant lasts through that day (UTC).
    const d = new Date(`${input.endsAt}T23:59:59.000Z`);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "End date is not a valid date." };
    endsAt = d;
  }
  const res = await grantTenantAddon({
    organizationId: org.id,
    addonId: input.addonId,
    quantity: input.quantity,
    note: input.note,
    endsAt,
    actor: { userId: actor.id, email: actor.email },
  });
  if (!res.ok) return res;
  revalidatePath(`/admin/orgs/${org.id}`);
  return { ok: true };
}

export async function revokeAddonAction(input: { organizationId: string; tenantAddonId: string }): Promise<{ ok: true; source: "manual" | "stripe" } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  if (!input.organizationId || !input.tenantAddonId) return { ok: false, error: "Pick a grant." };
  const res = await revokeTenantAddon({
    organizationId: input.organizationId,
    tenantAddonId: input.tenantAddonId,
    actor: { userId: actor.id, email: actor.email },
  });
  if (!res.ok) return res;
  revalidatePath(`/admin/orgs/${input.organizationId}`);
  return res;
}
