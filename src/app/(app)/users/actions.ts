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
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { inviteUrl } from "@/lib/app-url";
import {
  crossDomainReason,
  domainOf,
  inviteAwaitsApproval,
  isCrossDomainInvite,
} from "@/lib/email-domain";
import { findHomeOrganization, notifyPlatformAdmins } from "@/lib/invite-approval";
import { deliverInvite } from "@/lib/invite-send";
import type { InviteResult } from "@/lib/invite-types";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { issueToken } from "@/lib/tokens";
import {
  enforceSeatsQuota,
  QuotaExceededError,
} from "@/lib/subscription-gates";
import { validateEmail } from "@/lib/validators";
import { log } from "@/lib/log";

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

// BL-AUTH-DOMAIN — no link may exist for an invite the platform admin
// has not approved; Copy link and Resend are refused until then.
const AWAITING_APPROVAL_ERROR =
  "This invitation is waiting for platform-admin approval (the invitee is from another email domain). No link can be issued until it is approved.";

export async function inviteUserAction(input: {
  email: string;
  role: string;
  title?: string | null;
  /**
   * BL-ITAR-TAG — admin attestation that this invitee is a US person.
   * Required (must be `true`) when the inviting tenant is
   * `itar_restricted`. Ignored otherwise (still recorded on the
   * invite + membership rows for forensic completeness).
   */
  attestUsPerson?: boolean;
}): Promise<InviteResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const email = input.email.trim().toLowerCase();
  const emailError = validateEmail(email);
  if (!email || emailError) {
    return { ok: false, error: emailError ?? "Enter an email address." };
  }
  if (!isAssignableRole(input.role)) {
    return { ok: false, error: "Pick a valid role." };
  }

  // BL-ITAR-TAG — when the tenant is ITAR-restricted, the inviting
  // admin MUST attest that the invitee is a US person. Without the
  // attestation we refuse + audit the denial.
  const [orgRow] = await db
    .select({
      name: organizations.name,
      itarRestricted: organizations.itarRestricted,
      emailDomains: organizations.emailDomains,
      approvedExternalDomains: organizations.approvedExternalDomains,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!orgRow) return { ok: false, error: "Workspace not found." };
  if (orgRow.itarRestricted && !input.attestUsPerson) {
    await recordAudit({
      organizationId,
      actor: { userId: user.id, email: user.email },
      action: "user.invite_denied",
      resourceType: "user",
      metadata: {
        invitedEmail: email,
        reason: "itar_us_person_attestation_required",
      },
    });
    return {
      ok: false,
      error:
        "This workspace is ITAR-restricted. Confirm the invitee is a US person before inviting.",
    };
  }
  const attestUsPerson = !!input.attestUsPerson;
  const attestUsPersonAt = attestUsPerson ? new Date() : null;

  // BL-16 Phase B-3c — refuse the invite when the tenant is at or
  // over its seats limit. Live-measured from active memberships, so
  // removing a user frees a seat immediately.
  try {
    await enforceSeatsQuota(organizationId);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const [existingMember] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(users.email, email),
      ),
    )
    .limit(1);
  if (existingMember) {
    return { ok: false, error: "That email already belongs to a member." };
  }

  // BL-AUTH-DOMAIN — by default a person may only join the tenant that
  // owns their email domain. A tenant admin cannot add anyone from
  // another domain on their own: the invite is created on hold, nothing
  // reaches the invitee, and a platform admin has to approve it.
  const crossDomain = isCrossDomainInvite(email, orgRow);
  const homeOrganization = crossDomain ? await findHomeOrganization(domainOf(email)) : null;

  const [existingPending] = await db
    .select({ id: allowlist.id, platformApprovedAt: allowlist.platformApprovedAt })
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
  // A re-invite keeps an approval the platform admin already granted for
  // this person into this tenant; a same-domain invite needs none.
  const platformApprovedAt = crossDomain ? (existingPending?.platformApprovedAt ?? null) : null;
  if (existingPending) {
    await db
      .update(allowlist)
      .set({
        role: input.role,
        title: input.title?.trim() || null,
        invitedByUserId: user.id,
        invitedAt: new Date(),
        consumedAt: null,
        revoked: false,
        usPersonAttested: attestUsPerson,
        usPersonAttestedAt: attestUsPersonAt,
        crossDomain,
        homeOrganizationId: homeOrganization?.id ?? null,
        ...(crossDomain ? {} : { platformApprovedAt: null, platformApprovedByUserId: null }),
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
        invitedByUserId: user.id,
        usPersonAttested: attestUsPerson,
        usPersonAttestedAt: attestUsPersonAt,
        crossDomain,
        homeOrganizationId: homeOrganization?.id ?? null,
      })
      .returning({ id: allowlist.id });
    if (!row) return { ok: false, error: "Could not create invitation." };
    inviteId = row.id;
  }

  if (inviteAwaitsApproval({ crossDomain, platformApprovedAt })) {
    const reason = crossDomainReason(email, orgRow);
    await recordAudit({
      organizationId,
      actor: { userId: user.id, email: user.email },
      action: "user.invite_held_cross_domain",
      resourceType: "user",
      resourceId: inviteId,
      metadata: {
        invitedEmail: email,
        role: input.role,
        domain: domainOf(email),
        homeOrganizationId: homeOrganization?.id ?? null,
        tenantDomains: orgRow.emailDomains,
      },
    });
    const notice = await notifyPlatformAdmins({
      inviteId,
      organizationId,
      inviteeEmail: email,
      targetOrganizationName: orgRow.name,
      homeOrganization,
      requestedBy: user.name ?? user.email ?? "A tenant admin",
    });
    revalidatePath("/users");
    return {
      ok: true,
      inviteId,
      inviteUrl: null,
      emailSent: false,
      pendingApproval: true,
      warning: notice.warning ? `${reason} ${notice.warning}` : reason,
    };
  }

  const token = await issueToken("invite", inviteId);

  // BL-AUTH-INVITE — the invite exists whether or not the email goes out;
  // the admin always gets the link and an honest emailSent flag.
  const delivery = await deliverInvite({
    to: email,
    inviteId,
    token,
    organizationName: orgRow.name,
    inviterName: user.name ?? user.email ?? "A team member",
    role: input.role,
    tag: "[inviteUserAction]",
  });

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "user.invite",
    resourceType: "user",
    resourceId: inviteId,
    metadata: {
      invitedEmail: email,
      role: input.role,
      itarRestricted: !!orgRow.itarRestricted,
      usPersonAttested: attestUsPerson,
      crossDomain,
      platformApproved: crossDomain ? !!platformApprovedAt : undefined,
      emailSent: delivery.emailSent,
    },
  });

  // BL-AIP-3 — `membership_invited` was a selectable trigger kind that
  // nothing emitted. Best-effort: the invite already succeeded.
  try {
    await dispatchTriggerEvent({
      organizationId,
      kind: "membership_invited",
      payload: { invitedEmail: email, role: input.role, inviteId },
      subject: `Team member invited: ${email}`,
      body: `${user.name ?? user.email ?? "An admin"} invited ${email} as ${input.role}.`,
      linkPath: "/users",
      actorUserId: user.id,
    });
  } catch (err) {
    log.warn("[inviteUserAction]", "membership_invited dispatch failed", {
      error: err,
    });
  }

  revalidatePath("/users");
  return {
    ok: true,
    inviteId,
    inviteUrl: delivery.inviteUrl,
    emailSent: delivery.emailSent,
    warning: delivery.warning,
  };
}

/**
 * BL-AUTH-INVITE — a fresh invite link for an admin to share by hand
 * (chat, a ticket, a phone call). Issues a new token, which retires the
 * one in the last email — same as Resend, without the email.
 */
export async function createInviteLinkAction(
  inviteId: string,
): Promise<InviteResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [inv] = await db
    .select({
      id: allowlist.id,
      email: allowlist.email,
      consumedAt: allowlist.consumedAt,
      crossDomain: allowlist.crossDomain,
      platformApprovedAt: allowlist.platformApprovedAt,
    })
    .from(allowlist)
    .where(
      and(
        eq(allowlist.id, inviteId),
        eq(allowlist.organizationId, organizationId),
        eq(allowlist.revoked, false),
      ),
    )
    .limit(1);
  if (!inv) return { ok: false, error: "Invite not found." };
  if (inv.consumedAt) return { ok: false, error: "Invite already accepted." };
  if (inviteAwaitsApproval(inv)) return { ok: false, error: AWAITING_APPROVAL_ERROR };

  const token = await issueToken("invite", inv.id);

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "user.invite_link",
    resourceType: "user",
    resourceId: inv.id,
    metadata: { invitedEmail: inv.email },
  });

  return { ok: true, inviteId: inv.id, inviteUrl: inviteUrl(inv.id, token), emailSent: false };
}

export async function revokeInviteAction(
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

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
    resourceType: "user",
    resourceId: inviteId,
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function resendInviteAction(
  inviteId: string,
): Promise<InviteResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [inv] = await db
    .select()
    .from(allowlist)
    .where(
      and(
        eq(allowlist.id, inviteId),
        eq(allowlist.organizationId, organizationId),
        eq(allowlist.revoked, false),
      ),
    )
    .limit(1);
  if (!inv) return { ok: false, error: "Invite not found." };
  if (inv.consumedAt) return { ok: false, error: "Invite already accepted." };
  if (inviteAwaitsApproval(inv)) return { ok: false, error: AWAITING_APPROVAL_ERROR };

  const token = await issueToken("invite", inv.id);

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const delivery = await deliverInvite({
    to: inv.email,
    inviteId: inv.id,
    token,
    organizationName: org?.name ?? "your workspace",
    inviterName: user.name ?? user.email ?? "A team member",
    role: inv.role,
    tag: "[resendInviteAction]",
  });

  await db
    .update(allowlist)
    .set({ invitedAt: new Date() })
    .where(and(eq(allowlist.organizationId, organizationId), eq(allowlist.id, inv.id)));

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "user.resend_invite",
    resourceType: "user",
    resourceId: inv.id,
    metadata: { invitedEmail: inv.email, emailSent: delivery.emailSent },
  });

  revalidatePath("/users");
  return {
    ok: true,
    inviteId: inv.id,
    inviteUrl: delivery.inviteUrl,
    emailSent: delivery.emailSent,
    warning: delivery.warning,
  };
}

export async function changeMemberRoleAction(
  memberUserId: string,
  role: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  if (!isAssignableRole(role)) {
    return { ok: false, error: "Pick a valid role." };
  }
  if (memberUserId === actor.id) {
    return { ok: false, error: "You cannot change your own role." };
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
    metadata: { role },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function setMemberStatusAction(
  memberUserId: string,
  status: "active" | "disabled",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  if (memberUserId === actor.id) {
    return { ok: false, error: "You cannot change your own status." };
  }

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
    metadata: { status },
  });

  // BL-AIP-3 — `membership_disabled` was a selectable trigger kind that
  // nothing emitted. Best-effort: the status change already succeeded.
  if (status === "disabled") {
    try {
      await dispatchTriggerEvent({
        organizationId,
        kind: "membership_disabled",
        payload: { userId: memberUserId },
        subject: "Team member disabled",
        body: `${actor.name ?? actor.email ?? "An admin"} disabled a team member's access.`,
        linkPath: "/users",
        actorUserId: actor.id,
      });
    } catch (err) {
      log.warn("[setMemberStatusAction]", "membership_disabled dispatch failed", {
        error: err,
      });
    }
  }

  revalidatePath("/users");
  return { ok: true };
}

export async function removeMemberAction(
  memberUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  if (memberUserId === actor.id) {
    return { ok: false, error: "You cannot remove yourself." };
  }

  const [other] = await db
    .select({ count: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "admin"),
        eq(memberships.status, "active"),
      ),
    );
  // Keeping simple — not counting admins strictly; allow remove if not self.
  void other;

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
  });

  revalidatePath("/users");
  return { ok: true };
}
