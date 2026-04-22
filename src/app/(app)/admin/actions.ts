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
import { sendInviteEmail, sendPasswordResetEmail } from "@/lib/email";
import { issueToken } from "@/lib/tokens";
import { defaultOrgSlug } from "@/lib/org-defaults";
import { validateEmail } from "@/lib/validators";

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
    console.error("[createOrganizationAction] sendInviteEmail failed", err);
    return {
      ok: false,
      error:
        "Organization created, but the invite email could not be sent. Resend from the org panel.",
    };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function setOrgDisabledAction(
  orgId: string,
  disabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSuperadmin();
  await db
    .update(organizations)
    .set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
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
  revalidatePath("/admin");
  return { ok: true };
}

export async function forcePasswordResetAction(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSuperadmin();

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
    console.error("[forcePasswordResetAction] send failed", err);
    return { ok: false, error: "Could not send reset email." };
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
    console.error("[resendOrgAdminInviteAction] send failed", err);
    return { ok: false, error: "Could not resend invite." };
  }

  await db
    .update(allowlist)
    .set({ invitedAt: new Date() })
    .where(eq(allowlist.id, inv.id));

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

  await db.delete(organizations).where(eq(organizations.id, orgId));
  revalidatePath("/admin");
  return { ok: true };
}
