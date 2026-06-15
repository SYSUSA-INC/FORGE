"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { allowlist, memberships, type Role } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { sendInviteEmail } from "@/lib/email";
import { issueToken } from "@/lib/tokens";
import { log } from "@/lib/log";

/**
 * BL-15 Phase B-3a — SuperAdmin per-tenant user management.
 *
 * These actions mirror the tenant-admin user actions in
 * `src/app/(app)/users/actions.ts` but operate cross-tenant under
 * `requireSuperadmin()`. Used when a tenant gets stuck (e.g., the
 * primary admin left without promoting a replacement, a member is
 * locked out, an invite needs to be re-sent, etc.).
 *
 * Audit posture: every action writes a row into the TARGET tenant's
 * audit log so the tenant's own admins can later see what was done
 * on their behalf. The actor email is the superadmin's, not the
 * tenant admin's, so the log clearly attributes the change to
 * platform support.
 *
 * Isolation: each action takes `organizationId` as the FIRST parameter
 * because the superadmin caller controls which tenant to act on.
 * Cross-tenant by design, gated by `requireSuperadmin()` only.
 * Allow-listed in `.isolation-allow.json`.
 */

const ASSIGNABLE_ROLES: Role[] = [
  "admin",
  "capture",
  "proposal",
  "author",
  "reviewer",
  "pricing",
  "viewer",
];

function isAssignableRole(v: unknown): v is Role {
  return typeof v === "string" && (ASSIGNABLE_ROLES as string[]).includes(v);
}

export async function superadminChangeMemberRoleAction(
  organizationId: string,
  memberUserId: string,
  role: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  if (!isAssignableRole(role)) {
    return { ok: false, error: "Pick a valid role." };
  }

  await db
    .update(memberships)
    .set({ role, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.userId, memberUserId),
        eq(memberships.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.role_change",
    resourceType: "user",
    resourceId: memberUserId,
    metadata: { role, viaSuperadmin: true },
  });

  revalidatePath(`/admin/orgs/${organizationId}/users`);
  return { ok: true };
}

export async function superadminSetMembershipStatusAction(
  organizationId: string,
  memberUserId: string,
  status: "active" | "disabled",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  await db
    .update(memberships)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.userId, memberUserId),
        eq(memberships.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: status === "disabled" ? "user.disable" : "user.enable",
    resourceType: "user",
    resourceId: memberUserId,
    metadata: { status, viaSuperadmin: true },
  });

  revalidatePath(`/admin/orgs/${organizationId}/users`);
  return { ok: true };
}

export async function superadminRemoveMemberAction(
  organizationId: string,
  memberUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  // Refuse to remove the last active admin — the tenant would be
  // stranded. Use transfer-ownership / promote-another-member first.
  const activeAdmins = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "admin"),
        eq(memberships.status, "active"),
      ),
    );
  const isOnlyActiveAdmin =
    activeAdmins.length === 1 && activeAdmins[0]?.userId === memberUserId;
  if (isOnlyActiveAdmin) {
    return {
      ok: false,
      error:
        "Can't remove the only active admin — promote another member to admin first, or use Transfer ownership on the tenant detail page.",
    };
  }

  await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.userId, memberUserId),
        eq(memberships.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.remove",
    resourceType: "user",
    resourceId: memberUserId,
    metadata: { viaSuperadmin: true },
  });

  revalidatePath(`/admin/orgs/${organizationId}/users`);
  return { ok: true };
}

export async function superadminRevokeInviteAction(
  organizationId: string,
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  await db
    .update(allowlist)
    .set({ revoked: true })
    .where(
      and(
        eq(allowlist.id, inviteId),
        eq(allowlist.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.invite_revoke",
    resourceType: "invite",
    resourceId: inviteId,
    metadata: { viaSuperadmin: true },
  });

  revalidatePath(`/admin/orgs/${organizationId}/users`);
  return { ok: true };
}

export async function superadminResendInviteAction(
  organizationId: string,
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  const [invite] = await db
    .select({
      id: allowlist.id,
      email: allowlist.email,
      role: allowlist.role,
      organizationId: allowlist.organizationId,
      consumedAt: allowlist.consumedAt,
      revoked: allowlist.revoked,
    })
    .from(allowlist)
    .where(
      and(
        eq(allowlist.id, inviteId),
        eq(allowlist.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!invite) return { ok: false, error: "Invite not found." };
  if (invite.consumedAt)
    return { ok: false, error: "Invite already consumed." };
  if (invite.revoked)
    return { ok: false, error: "Invite was revoked. Create a new one instead." };

  const token = await issueToken("invite", invite.id);

  try {
    await sendInviteEmail({
      to: invite.email,
      inviteId: invite.id,
      token,
      organizationName: "your organization", // Email helper renders org name from context; minimal fallback
      inviterName: actor.name ?? actor.email ?? "Platform admin",
      role: invite.role,
    });
  } catch (err) {
    log.error("[superadminResendInviteAction]", "sendInviteEmail failed", {
      error: err,
      inviteId,
      organizationId,
    });
    return {
      ok: false,
      error: "Failed to send invite email. Check email service status.",
    };
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.invite_resend",
    resourceType: "invite",
    resourceId: inviteId,
    metadata: { viaSuperadmin: true },
  });

  return { ok: true };
}
