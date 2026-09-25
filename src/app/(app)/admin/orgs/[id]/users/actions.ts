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
import { recordAudit } from "@/lib/audit-log";
import { inviteUrl } from "@/lib/app-url";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { domainOf, inviteAwaitsApproval, isCrossDomainInvite } from "@/lib/email-domain";
import {
  approveCrossDomainInvite,
  denyCrossDomainInvite,
  findHomeOrganization,
} from "@/lib/invite-approval";
import { deliverInvite } from "@/lib/invite-send";
import type { InviteResult } from "@/lib/invite-types";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import {
  enforceSeatsQuota,
  QuotaExceededError,
} from "@/lib/subscription-gates";
import { issueToken } from "@/lib/tokens";
import { validateEmail } from "@/lib/validators";
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
 * BL-AUTH-INVITE adds `superadminInviteUserAction`: a platform admin is
 * not a member of the tenants they support, so the tenant-scoped invite
 * action (which reads the org from the session) cannot serve them. The
 * tenant is an explicit, mandatory parameter here; tenant admins keep
 * the session-scoped action and can only ever invite into their own
 * tenant.
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

export async function superadminInviteUserAction(
  organizationId: string,
  input: {
    email: string;
    role: string;
    title?: string | null;
    attestUsPerson?: boolean;
  },
): Promise<InviteResult> {
  const actor = await requireSuperadmin();

  if (!organizationId) return { ok: false, error: "Pick the tenant to invite into." };
  const email = input.email.trim().toLowerCase();
  const emailError = validateEmail(email);
  if (!email || emailError) {
    return { ok: false, error: emailError ?? "Enter an email address." };
  }
  if (!isAssignableRole(input.role)) {
    return { ok: false, error: "Pick a valid role." };
  }

  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      disabledAt: organizations.disabledAt,
      itarRestricted: organizations.itarRestricted,
      emailDomains: organizations.emailDomains,
      approvedExternalDomains: organizations.approvedExternalDomains,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Tenant not found." };
  if (org.disabledAt) return { ok: false, error: "That tenant is disabled. Enable it before inviting." };

  // BL-AUTH-DOMAIN — a platform admin IS the approver, so a cross-domain
  // invite issued here is stamped approved at creation (and audited as
  // such) instead of being held.
  const crossDomain = isCrossDomainInvite(email, org);
  const homeOrganization = crossDomain ? await findHomeOrganization(domainOf(email)) : null;
  const approvalStamp = crossDomain
    ? { platformApprovedAt: new Date(), platformApprovedByUserId: actor.id }
    : { platformApprovedAt: null, platformApprovedByUserId: null };

  if (org.itarRestricted && !input.attestUsPerson) {
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "user.invite_denied",
      resourceType: "user",
      metadata: {
        invitedEmail: email,
        reason: "itar_us_person_attestation_required",
        viaSuperadmin: true,
      },
    });
    return {
      ok: false,
      error:
        "This tenant is ITAR-restricted. Confirm the invitee is a US person before inviting.",
    };
  }
  const attestUsPerson = !!input.attestUsPerson;
  const attestUsPersonAt = attestUsPerson ? new Date() : null;

  try {
    await enforceSeatsQuota(organizationId);
  } catch (err) {
    if (err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }

  const [existingMember] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(users.email, email)))
    .limit(1);
  if (existingMember) {
    return { ok: false, error: "That email already belongs to a member of this tenant." };
  }

  const [existingPending] = await db
    .select({ id: allowlist.id })
    .from(allowlist)
    .where(
      and(
        eq(allowlist.organizationId, organizationId),
        eq(allowlist.email, email),
        eq(allowlist.revoked, false),
      ),
    )
    .limit(1);

  let inviteId: string;
  if (existingPending) {
    await db
      .update(allowlist)
      .set({
        role: input.role,
        title: input.title?.trim() || null,
        invitedByUserId: actor.id,
        invitedAt: new Date(),
        consumedAt: null,
        revoked: false,
        usPersonAttested: attestUsPerson,
        usPersonAttestedAt: attestUsPersonAt,
        crossDomain,
        homeOrganizationId: homeOrganization?.id ?? null,
        ...approvalStamp,
      })
      .where(and(eq(allowlist.organizationId, organizationId), eq(allowlist.id, existingPending.id)));
    inviteId = existingPending.id;
  } else {
    const [row] = await db
      .insert(allowlist)
      .values({
        email,
        organizationId,
        role: input.role,
        title: input.title?.trim() || null,
        invitedByUserId: actor.id,
        usPersonAttested: attestUsPerson,
        usPersonAttestedAt: attestUsPersonAt,
        crossDomain,
        homeOrganizationId: homeOrganization?.id ?? null,
        ...approvalStamp,
      })
      .returning({ id: allowlist.id });
    if (!row) return { ok: false, error: "Could not create invitation." };
    inviteId = row.id;
  }

  const token = await issueToken("invite", inviteId);
  const delivery = await deliverInvite({
    to: email,
    inviteId,
    token,
    organizationName: org.name,
    inviterName: actor.name ?? actor.email ?? "Platform admin",
    role: input.role,
    tag: "[superadminInviteUserAction]",
  });

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.invite",
    resourceType: "user",
    resourceId: inviteId,
    metadata: {
      invitedEmail: email,
      role: input.role,
      itarRestricted: !!org.itarRestricted,
      usPersonAttested: attestUsPerson,
      crossDomain,
      platformApproved: crossDomain ? true : undefined,
      homeOrganizationId: homeOrganization?.id ?? null,
      emailSent: delivery.emailSent,
      viaSuperadmin: true,
    },
  });

  try {
    await dispatchTriggerEvent({
      organizationId,
      kind: "membership_invited",
      payload: { invitedEmail: email, role: input.role, inviteId, viaSuperadmin: true },
      subject: `Team member invited: ${email}`,
      body: `${actor.name ?? actor.email ?? "Platform support"} invited ${email} as ${input.role}.`,
      linkPath: "/users",
      actorUserId: actor.id,
    });
  } catch (err) {
    log.warn("[superadminInviteUserAction]", "membership_invited dispatch failed", { error: err });
  }

  revalidatePath(`/admin/orgs/${organizationId}/users`);
  revalidatePath("/admin");
  return {
    ok: true,
    inviteId,
    inviteUrl: delivery.inviteUrl,
    emailSent: delivery.emailSent,
    warning: delivery.warning,
  };
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

type PendingInvite = {
  id: string;
  email: string;
  role: Role;
  organizationName: string;
};

async function loadPendingInvite(
  organizationId: string,
  inviteId: string,
): Promise<{ ok: false; error: string } | { ok: true; invite: PendingInvite }> {
  const [invite] = await db
    .select({
      id: allowlist.id,
      email: allowlist.email,
      role: allowlist.role,
      consumedAt: allowlist.consumedAt,
      revoked: allowlist.revoked,
      crossDomain: allowlist.crossDomain,
      platformApprovedAt: allowlist.platformApprovedAt,
      organizationName: organizations.name,
    })
    .from(allowlist)
    .innerJoin(organizations, eq(organizations.id, allowlist.organizationId))
    .where(
      and(
        eq(allowlist.id, inviteId),
        eq(allowlist.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!invite) return { ok: false, error: "Invite not found." };
  if (invite.consumedAt) return { ok: false, error: "Invite already consumed." };
  if (invite.revoked) return { ok: false, error: "Invite was revoked. Create a new one instead." };
  // BL-AUTH-DOMAIN — a held invite has no link; approve it first.
  if (inviteAwaitsApproval(invite)) {
    return {
      ok: false,
      error:
        "This cross-domain invitation is waiting for platform approval. Approve it (which sends the invitation) instead of resending.",
    };
  }
  return {
    ok: true,
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      organizationName: invite.organizationName,
    },
  };
}

export async function superadminResendInviteAction(
  organizationId: string,
  inviteId: string,
): Promise<InviteResult> {
  const actor = await requireSuperadmin();

  const loaded = await loadPendingInvite(organizationId, inviteId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const invite = loaded.invite;

  const token = await issueToken("invite", invite.id);
  const delivery = await deliverInvite({
    to: invite.email,
    inviteId: invite.id,
    token,
    organizationName: invite.organizationName,
    inviterName: actor.name ?? actor.email ?? "Platform admin",
    role: invite.role,
    tag: "[superadminResendInviteAction]",
  });

  await db
    .update(allowlist)
    .set({ invitedAt: new Date() })
    .where(and(eq(allowlist.organizationId, organizationId), eq(allowlist.id, invite.id)));

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.invite_resend",
    resourceType: "invite",
    resourceId: inviteId,
    metadata: { viaSuperadmin: true, emailSent: delivery.emailSent },
  });

  revalidatePath(`/admin/orgs/${organizationId}/users`);
  return {
    ok: true,
    inviteId: invite.id,
    inviteUrl: delivery.inviteUrl,
    emailSent: delivery.emailSent,
    warning: delivery.warning,
  };
}

/**
 * BL-AUTH-DOMAIN — approve a cross-domain invitation. Only a platform
 * superadmin can do this; the tenant's own admins cannot. Approving
 * issues the link and emails the invitee. With `allowDomain` the
 * invitee's domain is also added to the tenant's approved external
 * domains, so later invites from it need no approval.
 */
export async function superadminApproveCrossDomainInviteAction(
  organizationId: string,
  inviteId: string,
  options?: { allowDomain?: boolean },
): Promise<InviteResult> {
  const actor = await requireSuperadmin();
  if (!organizationId || !inviteId) return { ok: false, error: "Invite not found." };

  const res = await approveCrossDomainInvite({
    inviteId,
    organizationId,
    actor: { id: actor.id, email: actor.email, name: actor.name },
    allowDomain: !!options?.allowDomain,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/admin");
  revalidatePath(`/admin/orgs/${organizationId}`);
  revalidatePath(`/admin/orgs/${organizationId}/users`);
  revalidatePath("/users");
  return {
    ok: true,
    inviteId: res.inviteId,
    inviteUrl: res.delivery.inviteUrl,
    emailSent: res.delivery.emailSent,
    warning: res.domainAllowed
      ? `${res.domainAllowed} is now an approved domain for this tenant.${res.delivery.warning ? ` ${res.delivery.warning}` : ""}`
      : res.delivery.warning,
  };
}

/** BL-AUTH-DOMAIN — deny (revoke) a cross-domain invitation. Audited. */
export async function superadminDenyCrossDomainInviteAction(
  organizationId: string,
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  if (!organizationId || !inviteId) return { ok: false, error: "Invite not found." };

  const res = await denyCrossDomainInvite({
    inviteId,
    organizationId,
    actor: { id: actor.id, email: actor.email },
  });
  if (!res.ok) return res;

  revalidatePath("/admin");
  revalidatePath(`/admin/orgs/${organizationId}/users`);
  revalidatePath("/users");
  return { ok: true };
}

/** BL-AUTH-INVITE — a fresh link to hand over by other means; no email. */
export async function superadminCreateInviteLinkAction(
  organizationId: string,
  inviteId: string,
): Promise<InviteResult> {
  const actor = await requireSuperadmin();

  const loaded = await loadPendingInvite(organizationId, inviteId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const invite = loaded.invite;

  const token = await issueToken("invite", invite.id);

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.invite_link",
    resourceType: "invite",
    resourceId: invite.id,
    metadata: { invitedEmail: invite.email, viaSuperadmin: true },
  });

  return { ok: true, inviteId: invite.id, inviteUrl: inviteUrl(invite.id, token), emailSent: false };
}
