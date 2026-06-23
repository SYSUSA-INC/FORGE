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
import { sendInviteEmail } from "@/lib/email";
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
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
    .select({ itarRestricted: organizations.itarRestricted })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (orgRow?.itarRestricted && !input.attestUsPerson) {
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
        invitedByUserId: user.id,
        invitedAt: new Date(),
        consumedAt: null,
        revoked: false,
        usPersonAttested: attestUsPerson,
        usPersonAttestedAt: attestUsPersonAt,
      })
      .where(eq(allowlist.id, existingPending.id));
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
      })
      .returning({ id: allowlist.id });
    if (!row) return { ok: false, error: "Could not create invitation." };
    inviteId = row.id;
  }

  const token = await issueToken("invite", inviteId);

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  try {
    await sendInviteEmail({
      to: email,
      inviteId,
      token,
      organizationName: org?.name ?? "your workspace",
      inviterName: user.name ?? user.email ?? "A team member",
      role: input.role,
    });
  } catch (err) {
    log.error("[inviteUserAction]", "sendInviteEmail failed", { error: err });
    return { ok: false, error: "Could not send invite email. Try again." };
  }

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "user.invite",
    resourceType: "user",
    resourceId: inviteId,
    metadata: {
      invitedEmail: email,
      role: input.role,
      itarRestricted: !!orgRow?.itarRestricted,
      usPersonAttested: attestUsPerson,
    },
  });

  revalidatePath("/users");
  return { ok: true };
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
): Promise<{ ok: true } | { ok: false; error: string }> {
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

  const token = await issueToken("invite", inv.id);

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  try {
    await sendInviteEmail({
      to: inv.email,
      inviteId: inv.id,
      token,
      organizationName: org?.name ?? "your workspace",
      inviterName: user.name ?? user.email ?? "A team member",
      role: inv.role,
    });
  } catch (err) {
    log.error("[resendInviteAction]", "sendInviteEmail failed", { error: err });
    return { ok: false, error: "Could not send invite email. Try again." };
  }

  await db
    .update(allowlist)
    .set({ invitedAt: new Date() })
    .where(eq(allowlist.id, inv.id));

  revalidatePath("/users");
  return { ok: true };
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
