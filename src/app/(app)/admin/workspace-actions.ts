"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { memberships, organizations } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { domainOf, isPublicEmailDomain } from "@/lib/email-domain";
import { log } from "@/lib/log";
import { defaultOrgName, defaultOrgSlug } from "@/lib/org-defaults";

export type CreateWorkspaceForSelfResult =
  | { ok: true; organizationId: string; created: boolean }
  | { ok: false; error: string };

/**
 * BL-QC-links — give a platform administrator a workspace of their own.
 *
 * A superadmin is usually created by `scripts/grant-superadmin.mjs`,
 * which flips a flag and nothing else; on an invite-only deployment no
 * workspace is ever provisioned for them. Until now the only ways out
 * were to impersonate a tenant (read-only) or to sign out and redeem an
 * invite to themselves (which also resets their password). This creates
 * an organization and an active admin membership for the caller in one
 * step. The session picks it up on the next request because the JWT
 * callback re-reads membership from the database every time.
 *
 * Idempotent: if the caller already has an active workspace, that one is
 * returned and nothing is created. Superadmin-only; audited.
 */
export async function createWorkspaceForSelfAction(input: {
  name?: string;
}): Promise<CreateWorkspaceForSelfResult> {
  const actor = await requireSuperadmin();

  const [existing] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, actor.id),
        eq(memberships.status, "active"),
        isNull(organizations.disabledAt),
      ),
    )
    .limit(1);
  if (existing) {
    return { ok: true, organizationId: existing.organizationId, created: false };
  }

  const name = (input.name ?? "").trim().slice(0, 128) || defaultOrgName(actor.name);

  // BL-AUTH-DOMAIN — the workspace owns its creator's domain (never a
  // public mailbox provider) so colleagues can be invited without a
  // per-invite approval.
  const ownDomain = domainOf(actor.email);
  const emailDomains = ownDomain && !isPublicEmailDomain(ownDomain) ? [ownDomain] : [];

  const [org] = await db
    .insert(organizations)
    .values({ name, slug: defaultOrgSlug(actor.name), emailDomains })
    .returning({ id: organizations.id });
  if (!org) return { ok: false, error: "Could not create the workspace." };

  try {
    await db.insert(memberships).values({
      userId: actor.id,
      organizationId: org.id,
      role: "admin",
      status: "active",
    });
  } catch (err) {
    log.error("[createWorkspaceForSelfAction]", "membership insert failed", { error: err });
    await db
      .delete(organizations)
      .where(eq(organizations.id, org.id))
      .catch(() => undefined);
    return { ok: false, error: "The workspace could not be attached to your account; nothing was kept." };
  }

  await recordAudit({
    organizationId: org.id,
    actor: { userId: actor.id, email: actor.email },
    action: "org.create",
    resourceType: "organization",
    resourceId: org.id,
    metadata: { name, superadmin: true, selfProvisioned: true },
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/onboarding");
  return { ok: true, organizationId: org.id, created: true };
}
