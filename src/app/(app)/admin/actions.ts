"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  allowlist,
  memberships,
  organizations,
  users,
} from "@/db/schema";
import { requireAuth, requireSuperadmin } from "@/lib/auth-helpers";
import {
  deleteUserAccount,
  listUnverifiedPurgeCandidates,
  purgeUnverifiedAccounts,
  type PurgeCandidate,
} from "@/lib/account-hygiene";
import { recordAudit } from "@/lib/audit-log";
import { currentSessionEpoch } from "@/auth";
import { emailConfigured, sendMfaResetEmail } from "@/lib/email";
import { inviteAwaitsApproval } from "@/lib/email-domain";
import { log } from "@/lib/log";
import { cleanResetReason } from "@/lib/mfa";
import { resetMfa } from "@/lib/mfa-store";
import { setPlatformSetting } from "@/lib/platform-settings";
import { deliverInvite, deliverPasswordReset } from "@/lib/invite-send";
import type { InviteResult, ResetLinkResult } from "@/lib/invite-types";
import { issueToken } from "@/lib/tokens";
import { provisionOrganizationWithAdminInvite } from "@/lib/org-provisioning";
import { validateEmail } from "@/lib/validators";


export async function createOrganizationAction(input: {
  orgName: string;
  adminEmail: string;
  adminTitle?: string | null;
}): Promise<InviteResult> {
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

  // The workspace, its domain, default tier, admin invite and org.create
  // audit row: shared with approved trial requests (BL-AUTH-ABUSE 2b).
  const res = await provisionOrganizationWithAdminInvite({
    orgName,
    adminEmail,
    adminTitle: input.adminTitle,
    actor: { id: actor.id, email: actor.email, name: actor.name },
  });
  if (!res.ok) return res;

  revalidatePath("/admin");
  return {
    ok: true,
    inviteId: res.inviteId,
    inviteUrl: res.inviteUrl,
    domainWarning: res.domainWarning,
    emailSent: res.emailSent,
    warning: res.warning,
  };
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
      // BL-STAB-8a-2 — disabling ends every open session at its next request.
      ...(disabled ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
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
): Promise<ResetLinkResult> {
  const actor = await requireSuperadmin();

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: "User not found." };

  const token = await issueToken("reset-password", user.email);

  // BL-AUTH-INVITE — when email is not configured (or fails) the
  // superadmin gets the link to pass on; before this the action reported
  // "sent" and the person stayed locked out.
  const delivery = await deliverPasswordReset({
    to: user.email,
    token,
    tag: "[forcePasswordResetAction]",
  });

  const auditOrgId = await resolveAuditOrgForUser(actor.organizationId, userId);
  if (auditOrgId) {
    await recordAudit({
      organizationId: auditOrgId,
      actor: { userId: actor.id, email: actor.email },
      action: "user.force_password_reset",
      resourceType: "user",
      resourceId: userId,
      metadata: { targetEmail: user.email, superadmin: true, emailSent: delivery.emailSent },
    });
  }

  return {
    ok: true,
    resetUrl: delivery.resetUrl,
    emailSent: delivery.emailSent,
    warning: delivery.warning,
  };
}

/**
 * BL-STAB-8a-4 — the superadmin two-step reset, with a written reason:
 * every factor and recovery code removed, every open session ended,
 * the person emailed with the reason, `user.mfa.reset` in the audit
 * log. Their password is untouched; they enrol again at the next
 * sign-in. Not for your own account (Settings → Security does that
 * with a current code).
 */
export async function resetUserMfaAction(
  userId: string,
  reasonInput: string,
): Promise<{ ok: true; factors: number; emailSent: boolean; warning?: string } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  if (userId === actor.id) return { ok: false, error: "Reset your own two-step sign-in from Settings → Security." };
  const reason = cleanResetReason(reasonInput);
  if (!reason.ok) return reason;

  const [user] = await db
    .select({ email: users.email, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: "User not found." };

  const removed = await resetMfa(userId);

  let emailSent = false;
  let warning: string | undefined;
  try {
    if (!emailConfigured()) throw new Error("email is not configured on this deployment");
    await sendMfaResetEmail({ to: user.email, reason: reason.reason, byEmail: actor.email ?? null });
    emailSent = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("[resetUserMfaAction]", "reset email failed", { userId, error: message });
    warning = `The reset is done but the email could not be sent (${message}). Tell the person yourself: their next sign-in sets two-step sign-in up again.`;
  }

  log.info("[auth]", "mfa reset by superadmin", { userId, actorId: actor.id, ...removed, emailSent });
  const auditOrgId = await resolveAuditOrgForUser(actor.organizationId, userId);
  if (auditOrgId) {
    await recordAudit({
      organizationId: auditOrgId,
      actor: { userId: actor.id, email: actor.email },
      action: "user.mfa.reset",
      resourceType: "user",
      resourceId: userId,
      metadata: { targetEmail: user.email, reason: reason.reason, factorsRemoved: removed.factors, recoveryCodesRemoved: removed.recoveryCodes, emailSent, superadmin: true },
    });
  }
  revalidatePath("/admin");
  return { ok: true, factors: removed.factors, emailSent, warning };
}

/**
 * BL-STAB-8a-4 — end every session on the platform at once, yours
 * included: the platform epoch moves, and each session sees it at its
 * next request (within a minute). Nobody's factors change. The release
 * step of the two-step rollout, and the lever for a suspected token
 * leak.
 */
export async function endAllSessionsAction(reasonInput: string): Promise<{ ok: true; epoch: number } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const reason = cleanResetReason(reasonInput);
  if (!reason.ok) return reason;
  const epoch = (await currentSessionEpoch()) + 1;
  await setPlatformSetting("auth.session_epoch", String(epoch), actor.id);
  log.warn("[auth]", "session epoch raised: every session ends", { epoch, actorId: actor.id, reason: reason.reason });
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "auth.sessions.end_all",
      resourceType: "platform",
      resourceId: "auth.session_epoch",
      metadata: { epoch, reason: reason.reason, superadmin: true },
    });
  }
  return { ok: true, epoch };
}

export async function resendOrgAdminInviteAction(
  inviteId: string,
): Promise<InviteResult> {
  const actor = await requireAuth();
  await requireSuperadmin();

  const [inv] = await db
    .select()
    .from(allowlist)
    .where(and(eq(allowlist.id, inviteId), eq(allowlist.revoked, false)))
    .limit(1);
  if (!inv) return { ok: false, error: "Invite not found." };
  if (inv.consumedAt) return { ok: false, error: "Invite already accepted." };
  if (inviteAwaitsApproval(inv)) {
    return {
      ok: false,
      error:
        "This invitation is waiting for platform approval. Approve it under Cross-domain approvals instead of resending.",
    };
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, inv.organizationId))
    .limit(1);

  const token = await issueToken("invite", inv.id);

  const delivery = await deliverInvite({
    to: inv.email,
    inviteId: inv.id,
    token,
    organizationName: org?.name ?? "a workspace",
    inviterName: actor.name ?? actor.email ?? "Platform admin",
    role: inv.role,
    tag: "[resendOrgAdminInviteAction]",
  });

  await db
    .update(allowlist)
    .set({ invitedAt: new Date() })
    .where(and(eq(allowlist.organizationId, inv.organizationId), eq(allowlist.id, inv.id)));

  await recordAudit({
    organizationId: inv.organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.resend_invite",
    resourceType: "allowlist",
    resourceId: inv.id,
    metadata: { email: inv.email, role: inv.role, superadmin: true, emailSent: delivery.emailSent },
  });

  revalidatePath("/admin");
  return {
    ok: true,
    inviteId: inv.id,
    inviteUrl: delivery.inviteUrl,
    emailSent: delivery.emailSent,
    warning: delivery.warning,
  };
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
 * BL-AUTH-ABUSE Slice 1 — delete one account (spam, bot, granted in
 * error). Refuses yourself, platform admins and the last admin of a
 * workspace with other members; `deleteSoleWorkspaces` also removes the
 * workspaces nobody else belongs to. Audited (user.delete).
 */
export async function deleteUserAction(
  userId: string,
  opts: { deleteSoleWorkspaces: boolean },
): Promise<{ ok: true; deletedWorkspaces: string[] } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  if (!userId) return { ok: false, error: "Pick a user." };
  const res = await deleteUserAccount({
    userId,
    actor: { id: actor.id, email: actor.email, organizationId: actor.organizationId },
    deleteSoleWorkspaces: !!opts?.deleteSoleWorkspaces,
  });
  if (!res.ok) return res;
  revalidatePath("/admin");
  return { ok: true, deletedWorkspaces: res.deletedWorkspaces.map((w) => w.name) };
}

/** BL-AUTH-ABUSE Slice 1 — what the bulk clean-up of unverified sign-ups would remove. Read-only. */
export async function previewUnverifiedPurgeAction(
  olderThanDays: number,
): Promise<{ ok: true; candidates: PurgeCandidate[]; sharedWorkspace: number; cutoff: string }> {
  await requireSuperadmin();
  const res = await listUnverifiedPurgeCandidates({ olderThanDays });
  return { ok: true, ...res };
}

/**
 * BL-AUTH-ABUSE Slice 1 — delete the previewed unverified accounts that
 * are still eligible, with the workspaces only they belonged to. Audited
 * once (user.purge_unverified).
 */
export async function purgeUnverifiedAccountsAction(input: {
  olderThanDays: number;
  userIds: string[];
}): Promise<{ ok: true; deleted: number; workspacesDeleted: number; skipped: number }> {
  const actor = await requireSuperadmin();
  const res = await purgeUnverifiedAccounts({
    olderThanDays: input.olderThanDays,
    userIds: Array.isArray(input.userIds) ? input.userIds.filter((id) => typeof id === "string") : [],
    actor: { id: actor.id, email: actor.email, organizationId: actor.organizationId },
  });
  revalidatePath("/admin");
  return { ok: true, ...res };
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
