"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  allowlist,
  memberships,
  organizations,
  users,
  type Role,
} from "@/db/schema";
import { requireAuth, requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { sendInviteEmail, sendPasswordResetEmail } from "@/lib/email";
import { issueToken } from "@/lib/tokens";
import { defaultOrgSlug } from "@/lib/org-defaults";
import { validateEmail } from "@/lib/validators";
import { log } from "@/lib/log";

export async function createOrganizationAction(input: {
  orgName: string;
  adminEmail: string;
  adminTitle?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  await requireSuperadmin();

  const orgName = input.orgName.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();

  if (!orgName) return { ok: false, error: "Enter an organization name." };
  if (orgName.length > 128)
    return { ok: false, error: "Organization name too long." };

  const emailError = validateEmail(adminEmail);
  if (!adminEmail || emailError) {
    return { ok: false, error: emailError ?? "Enter an admin email." };
  }

  const [org] = await db
    .insert(organizations)
    .values({
      name: orgName,
      slug: defaultOrgSlug(orgName),
    })
    .returning({ id: organizations.id });
  if (!org) return { ok: false, error: "Could not create organization." };

  const [invite] = await db
    .insert(allowlist)
    .values({
      email: adminEmail,
      organizationId: org.id,
      role: "admin" as Role,
      title: input.adminTitle?.trim() || null,
      invitedByUserId: actor.id,
    })
    .returning({ id: allowlist.id });
  if (!invite) {
    await db
      .delete(organizations)
      .where(eq(organizations.id, org.id))
      .catch(() => undefined);
    return { ok: false, error: "Could not create invitation." };
  }

  const token = await issueToken("invite", invite.id);

  try {
    await sendInviteEmail({
      to: adminEmail,
      inviteId: invite.id,
      token,
      organizationName: orgName,
      inviterName: actor.name ?? actor.email ?? "Platform admin",
      role: "admin",
    });
  } catch (err) {
    log.error("[createOrganizationAction]", "sendInviteEmail failed", { error: err });
    return {
      ok: false,
      error:
        "Organization created, but the invite email could not be sent. Resend from the org panel.",
    };
  }

  await recordAudit({
    organizationId: org.id,
    actor: { userId: actor.id, email: actor.email },
    action: "org.create",
    resourceType: "organization",
    resourceId: org.id,
    metadata: { name: orgName, primaryAdminEmail: adminEmail, superadmin: true },
  });

  revalidatePath("/admin");
  return { ok: true };
}

export async function setOrgDisabledAction(
  orgId: string,
  disabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  await db
    .update(organizations)
    .set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
  await recordAudit({
    organizationId: orgId,
    actor: { userId: actor.id, email: actor.email },
    action: disabled ? "org.disable" : "org.restore",
    resourceType: "organization",
    resourceId: orgId,
    metadata: { superadmin: true },
  });
  revalidatePath("/admin");
  return { ok: true };
}

export async function setUserSuperadminAction(
  userId: string,
  isSuperadmin: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  await requireSuperadmin();
  if (userId === actor.id && !isSuperadmin) {
    return { ok: false, error: "You cannot revoke your own superadmin." };
  }
  await db
    .update(users)
    .set({ isSuperadmin, updatedAt: new Date() })
    .where(eq(users.id, userId));
  // Superadmin flag is platform-wide; fall back to the actor's org for
  // the audit row, or the target user's primary org membership.
  const auditOrgId = await resolveAuditOrgForUser(actor.organizationId, userId);
  if (auditOrgId) {
    await recordAudit({
      organizationId: auditOrgId,
      actor: { userId: actor.id, email: actor.email },
      action: "user.set_superadmin",
      resourceType: "user",
      resourceId: userId,
      metadata: { isSuperadmin, superadmin: true },
    });
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function setUserDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  await requireSuperadmin();
  if (userId === actor.id && disabled) {
    return { ok: false, error: "You cannot disable your own account." };
  }
  await db
    .update(users)
    .set({
      disabledAt: disabled ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  const auditOrgId = await resolveAuditOrgForUser(actor.organizationId, userId);
  if (auditOrgId) {
    await recordAudit({
      organizationId: auditOrgId,
      actor: { userId: actor.id, email: actor.email },
      action: "user.set_disabled",
      resourceType: "user",
      resourceId: userId,
      metadata: { disabled, superadmin: true },
    });
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function forcePasswordResetAction(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: "User not found." };

  const token = await issueToken("reset-password", user.email);

  try {
    await sendPasswordResetEmail(user.email, token);
  } catch (err) {
    log.error("[forcePasswordResetAction]", "send failed", { error: err });
    return { ok: false, error: "Could not send reset email." };
  }

  const auditOrgId = await resolveAuditOrgForUser(actor.organizationId, userId);
  if (auditOrgId) {
    await recordAudit({
      organizationId: auditOrgId,
      actor: { userId: actor.id, email: actor.email },
      action: "user.force_password_reset",
      resourceType: "user",
      resourceId: userId,
      metadata: { targetEmail: user.email, superadmin: true },
    });
  }

  return { ok: true };
}

export async function resendOrgAdminInviteAction(
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  await requireSuperadmin();

  const [inv] = await db
    .select()
    .from(allowlist)
    .where(and(eq(allowlist.id, inviteId), eq(allowlist.revoked, false)))
    .limit(1);
  if (!inv) return { ok: false, error: "Invite not found." };
  if (inv.consumedAt) return { ok: false, error: "Invite already accepted." };

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, inv.organizationId))
    .limit(1);

  const token = await issueToken("invite", inv.id);

  try {
    await sendInviteEmail({
      to: inv.email,
      inviteId: inv.id,
      token,
      organizationName: org?.name ?? "a workspace",
      inviterName: actor.name ?? actor.email ?? "Platform admin",
      role: inv.role,
    });
  } catch (err) {
    log.error("[resendOrgAdminInviteAction]", "send failed", { error: err });
    return { ok: false, error: "Could not resend invite." };
  }

  await db
    .update(allowlist)
    .set({ invitedAt: new Date() })
    .where(eq(allowlist.id, inv.id));

  await recordAudit({
    organizationId: inv.organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.resend_invite",
    resourceType: "allowlist",
    resourceId: inv.id,
    metadata: { email: inv.email, role: inv.role, superadmin: true },
  });

  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteOrganizationAction(
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  await requireSuperadmin();

  // Prevent deleting the org the superadmin currently belongs to
  const [selfMembership] = await db
    .select({ orgId: memberships.organizationId })
    .from(memberships)
    .where(
      and(eq(memberships.userId, actor.id), eq(memberships.organizationId, orgId)),
    )
    .limit(1);
  if (selfMembership) {
    return {
      ok: false,
      error:
        "You are a member of this organization. Disable it instead, or remove yourself first.",
    };
  }

  // Snapshot the name before the delete so the audit row carries it.
  const [orgRow] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  await db.delete(organizations).where(eq(organizations.id, orgId));

  // Org row is gone; pin the audit to the actor's own org so the row
  // is reachable from the superadmin's audit view. Skip when the actor
  // has no org (rare but possible for bootstrap superadmins).
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "org.delete",
      resourceType: "organization",
      resourceId: orgId,
      metadata: { name: orgRow?.name ?? "", superadmin: true },
    });
  }

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Pick an organization id to attach a superadmin user-action audit row
 * to. Prefer the actor's current org (so they see the row in their own
 * audit view). Fall back to the target user's primary membership. Returns
 * null if neither yields an org — caller skips the audit row.
 */
async function resolveAuditOrgForUser(
  actorOrgId: string | null,
  targetUserId: string,
): Promise<string | null> {
  if (actorOrgId) return actorOrgId;
  const [m] = await db
    .select({ orgId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, targetUserId))
    .limit(1);
  return m?.orgId ?? null;
}
