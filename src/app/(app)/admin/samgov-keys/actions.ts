"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { reencryptCompanySamKeys, type ReencryptResult } from "@/lib/samgov-key-admin";
import { removeCompanySamKey } from "@/lib/samgov-key";

/**
 * BL-STAB-7e — a platform admin removes a company's own SAM.gov key (a
 * leaked or unusable key; the company falls back to FORGE's shared key) or
 * re-encrypts every company key after FORGE_SECRET_KEYS is rotated. Like
 * the other per-tenant admin actions, the target company is a parameter
 * because the platform admin acts on another organization; the removal
 * and its reason land in that company's audit log.
 */

export async function adminRemoveCompanySamKeyAction(input: {
  organizationId: string;
  reason: string;
  /** The key the page showed: its last four characters and when it was set (ISO). */
  expected: { last4: string; setAt: string };
}): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const reason = typeof input?.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return { ok: false, error: "Say why the key is being removed; the company sees it in its audit log." };
  const last4 = typeof input?.expected?.last4 === "string" ? input.expected.last4 : "";
  const setAt = new Date(typeof input?.expected?.setAt === "string" ? input.expected.setAt : NaN);
  if (last4.length !== 4 || Number.isNaN(setAt.getTime())) return { ok: false, error: "Reload the page and try again." };
  const organizationId = typeof input?.organizationId === "string" ? input.organizationId : "";
  const [org] = organizationId ? await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1) : [];
  if (!org) return { ok: false, error: "Organization not found." };
  const res = await removeCompanySamKey({ organizationId, actor: { userId: actor.id, email: actor.email ?? null }, platformReason: reason, expected: { last4, setAt } });
  revalidatePath("/admin/samgov-keys");
  return res;
}

export async function reencryptCompanySamKeysAction(): Promise<ReencryptResult> {
  const actor = await requireSuperadmin();
  const res = await reencryptCompanySamKeys();
  if (res.ok && actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email ?? null },
      action: "admin.samgov_keys.reencrypt",
      resourceType: "organization_samgov_key",
      metadata: { moved: res.moved, alreadyCurrent: res.alreadyCurrent, unreadable: res.unreadable, mismatched: res.mismatched.reduce((n, m) => n + m.count, 0), failed: res.failed },
    });
  }
  revalidatePath("/admin/samgov-keys");
  return res;
}
