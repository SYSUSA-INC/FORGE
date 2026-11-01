/**
 * BL-AUTH-INVITE — accept pending invitations for a user by email.
 *
 * The emailed invite link is one way in (sign-up form → /api/register,
 * which spends the token). This is the other: a user who signs in with
 * Google / Microsoft, or who already had an account, and whose email
 * has an un-consumed invite. The identity provider (or the existing
 * session) has already proven the email, so the invite's allow-list row
 * is the authorisation — no token needed.
 *
 * Before this, an invitee who chose "Continue with Google" under
 * SIGNUP_MODE=invite_only had their freshly-created user deleted by the
 * createUser guard and never learned why.
 *
 * Cross-tenant by nature (an email can hold invites to several tenants);
 * every write carries the invite's own organization_id. Server-only lib,
 * called from the NextAuth events, never from a client.
 *
 * BL-AUTH-DOMAIN — a cross-domain invite the platform admin has not yet
 * approved is skipped: the provider proving the address does not make
 * the tenant allowed to have it.
 */
import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, memberships, users } from "@/db/schema";
import { inviteAwaitsApproval } from "@/lib/email-domain";
import { log } from "@/lib/log";
import { consumeToken } from "@/lib/tokens";

export type AttachResult = {
  /** Memberships created (one per accepted invite). */
  attached: number;
  /** Invites that were already reflected by an existing membership. */
  alreadyMember: number;
  organizationIds: string[];
};

export async function attachPendingInvitesByEmail(input: {
  userId: string;
  email: string | null | undefined;
}): Promise<AttachResult> {
  const email = (input.email ?? "").trim().toLowerCase();
  const result: AttachResult = { attached: 0, alreadyMember: 0, organizationIds: [] };
  if (!email) return result;

  const invites = await db
    .select({
      id: allowlist.id,
      organizationId: allowlist.organizationId,
      role: allowlist.role,
      title: allowlist.title,
      usPersonAttested: allowlist.usPersonAttested,
      usPersonAttestedAt: allowlist.usPersonAttestedAt,
    })
    .from(allowlist)
    .where(
      and(
        eq(allowlist.email, email),
        eq(allowlist.revoked, false),
        isNull(allowlist.consumedAt),
        or(eq(allowlist.crossDomain, false), sql`${allowlist.platformApprovedAt} IS NOT NULL`),
      ),
    );

  for (const inv of invites) {
    const organizationId = inv.organizationId;
    const [existing] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, input.userId),
          eq(memberships.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      try {
        await db.insert(memberships).values({
          userId: input.userId,
          organizationId,
          role: inv.role,
          status: "active",
          title: inv.title,
          usPersonAttested: inv.usPersonAttested,
          usPersonAttestedAt: inv.usPersonAttestedAt,
        });
        result.attached += 1;
      } catch (err) {
        // Leave the invite consumable so the emailed link still works.
        log.error("[attachPendingInvitesByEmail]", "membership insert failed", {
          error: err,
          inviteId: inv.id,
          organizationId,
        });
        continue;
      }
    } else {
      result.alreadyMember += 1;
    }

    await db
      .update(allowlist)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(allowlist.id, inv.id),
          eq(allowlist.organizationId, organizationId),
        ),
      );
    result.organizationIds.push(organizationId);
  }

  if (result.attached > 0 || result.alreadyMember > 0) {
    // An accepted invite proves the address: the admin sent it there and
    // the provider (or the existing session) delivered the person.
    await db
      .update(users)
      .set({
        emailVerified: sql`COALESCE(${users.emailVerified}, now())`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId));
  }

  return result;
}

/**
 * BL-STAB-8a-0 — the emailed invite link, used on the sign-up form.
 * Creates the account and the membership for a new address. An address
 * that already has an account is refused before the token is spent:
 * the link proves the inbox, not the account, so it never sets that
 * account's password or name; the person signs in (or resets their
 * password, which proves the inbox too) and `attachPendingInvitesByEmail`
 * accepts the invite at that sign-in.
 */
export async function acceptInvite(opts: {
  inviteId: string;
  rawToken: string;
  name: string;
  passwordHash: string;
}): Promise<
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; error: string; status?: number; code?: "existing_account" }
> {
  const [inv] = await db
    .select()
    .from(allowlist)
    .where(
      and(eq(allowlist.id, opts.inviteId), eq(allowlist.revoked, false)),
    )
    .limit(1);

  if (!inv) return { ok: false, error: "Invitation not found or revoked.", status: 404 };
  if (inv.consumedAt) {
    return { ok: false, error: "Invitation already used.", status: 409 };
  }
  // BL-AUTH-DOMAIN — a cross-domain invite is unusable until a platform
  // admin approves it, whatever link the caller holds (a token from
  // before the tenant's domains changed must not get anyone in).
  // Checked before the token is spent so nothing is burned.
  if (inviteAwaitsApproval(inv)) {
    return {
      ok: false,
      error:
        "This invitation is waiting for platform-admin approval because your email domain is not part of that organization. You will get an email once it is approved.",
      status: 403,
    };
  }

  const email = inv.email.toLowerCase();

  // Checked before the token is spent, so the link stays usable for the
  // sign-in path and nothing about the existing account changes.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      code: "existing_account",
      error: "This email already has a FORGE account. Sign in with it (use Forgot password if you need to), and the invitation is accepted automatically.",
      status: 409,
    };
  }

  const ok = await consumeToken("invite", inv.id, opts.rawToken);
  if (!ok) {
    return { ok: false, error: "Invitation link is invalid or expired.", status: 400 };
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      name: opts.name || null,
      passwordHash: opts.passwordHash,
      emailVerified: new Date(),
    })
    .returning({ id: users.id });
  if (!created) {
    return { ok: false, error: "Could not create user.", status: 500 };
  }
  const userId = created.id;

  const [existingMembership] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, inv.organizationId),
      ),
    )
    .limit(1);

  // Membership insert MUST succeed before we mark the invite consumed.
  // Otherwise a transient DB error would burn the invite token without
  // creating the membership — the user couldn't retry (token gone) and
  // couldn't sign in (no membership). On failure we surface the error
  // and leave the allowlist row consumable.
  if (!existingMembership) {
    try {
      await db.insert(memberships).values({
        userId,
        organizationId: inv.organizationId,
        role: inv.role,
        status: "active",
        title: inv.title,
        // BL-ITAR-TAG — carry the admin's attestation forward onto the
        // membership row so per-member compliance queries don't need
        // to join through the (eventually expired) allowlist row.
        usPersonAttested: inv.usPersonAttested,
        usPersonAttestedAt: inv.usPersonAttestedAt,
      });
    } catch (err) {
      log.error("[acceptInvite]", "membership insert failed", { error: err });
      return {
        ok: false,
        error:
          "Could not finish creating your account — please try again or contact support.",
        status: 500,
      };
    }
  }

  // Only now is it safe to mark the invite consumed.
  await db
    .update(allowlist)
    .set({ consumedAt: new Date() })
    .where(eq(allowlist.id, inv.id));

  return { ok: true, userId, organizationId: inv.organizationId };
}
