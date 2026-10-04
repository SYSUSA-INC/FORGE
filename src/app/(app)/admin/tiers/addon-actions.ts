"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tenantAddons } from "@/db/schema";
import { createAddon, updateAddon } from "@/lib/addons";
import { sanitizeAddonInput } from "@/lib/addons-logic";
import { requireSuperadmin } from "@/lib/auth-helpers";

/**
 * BL-PACKAGES add-ons Slice 1 — the à la carte catalogue, edited by
 * platform admins on /admin/tiers. Platform-wide rows (no tenant
 * scope); audited like tier edits.
 */

export async function createAddonAction(raw: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const parsed = sanitizeAddonInput(raw);
  if (!parsed.ok) return parsed;
  const res = await createAddon({ value: parsed.value, actor: { userId: actor.id, email: actor.email, organizationId: actor.organizationId } });
  if (res.ok) {
    revalidatePath("/admin/tiers");
    revalidatePath("/settings/billing");
  }
  return res;
}

export async function updateAddonAction(id: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const parsed = sanitizeAddonInput(raw);
  if (!parsed.ok) return parsed;
  if (!parsed.value.active) {
    // Like retiring a tier: refuse while tenants still hold it, so a
    // paid-for add-on never vanishes from under them by accident.
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(tenantAddons)
      .where(and(eq(tenantAddons.addonId, id), eq(tenantAddons.status, "active")));
    if (Number(n) > 0) {
      return { ok: false, error: `Cannot retire this add-on — ${n} tenant grant(s) are active. Revoke them first.` };
    }
  }
  const { slug: _slug, ...value } = parsed.value;
  const res = await updateAddon({ id, value, actor: { userId: actor.id, email: actor.email, organizationId: actor.organizationId } });
  if (res.ok) {
    revalidatePath("/admin/tiers");
    revalidatePath("/settings/billing");
  }
  return res;
}
