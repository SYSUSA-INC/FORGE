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
import { log } from "@/lib/log";

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
