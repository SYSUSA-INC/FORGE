/**
 * BL-15 Phase B-3b — super-admin assume-identity (impersonation) helpers.
 *
 * Threat model + design:
 *   - A super-admin starts an impersonation session by calling
 *     `startImpersonationAction`. Server creates a row in
 *     `superadmin_impersonation_session` and sets a session cookie
 *     carrying the row id.
 *   - On every subsequent request, `getActiveImpersonationSession`
 *     reads the cookie, looks up the row, and returns it iff:
 *       (a) the row exists and belongs to the calling super-admin's user id,
 *       (b) it has not been ended, and
 *       (c) it has not expired.
 *     The cookie alone proves nothing — a forged cookie's session id
 *     either doesn't exist or belongs to a different user, so the
 *     server-side lookup rejects it.
 *   - `requireCurrentOrg` consults this helper. When an active session
 *     exists, the effective organizationId is the target — every
 *     downstream query reads as that tenant.
 *   - Mutations are blocked by middleware (see `src/middleware.ts`):
 *     any POST with a `Next-Action` header (i.e., a server action) is
 *     refused while the cookie is set, except the explicit
 *     "end impersonation" endpoint at `/api/admin/impersonation/end`.
 */

import { cookies } from "next/headers";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db } from "@/db";
import { superadminImpersonationSessions } from "@/db/schema";

/** Cookie name. Centralised so the route handler + middleware agree. */
export const IMPERSONATION_COOKIE_NAME = "forge_impersonation_session";

/** Default impersonation TTL — short enough that forgotten sessions auto-expire. */
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Sentinel value used by `recordAudit` so tenant admins can see the override. */
export const AUDIT_VIA_SUPERADMIN_IMPERSONATION = "via_superadmin_impersonation";

export type ActiveImpersonationSession = {
  id: string;
  superadminUserId: string;
  targetOrganizationId: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
};

/**
 * Look up the active impersonation session for the given super-admin
 * user. Returns null when:
 *   - no cookie is set
 *   - the cookie's session id has no matching row
 *   - the row belongs to a different user (forged cookie)
 *   - the row has been ended or expired
 *
 * The cookie is the source of which session id to look up; the DB row
 * is the source of truth for whether that id is currently active.
 */
export async function getActiveImpersonationSession(
  superadminUserId: string,
): Promise<ActiveImpersonationSession | null> {
  const jar = cookies();
  const cookie = jar.get(IMPERSONATION_COOKIE_NAME);
  if (!cookie?.value) return null;
  const sessionId = cookie.value.trim();
  if (!sessionId) return null;

  const [row] = await db
    .select({
      id: superadminImpersonationSessions.id,
      superadminUserId: superadminImpersonationSessions.superadminUserId,
      targetOrganizationId: superadminImpersonationSessions.targetOrganizationId,
      reason: superadminImpersonationSessions.reason,
      startedAt: superadminImpersonationSessions.startedAt,
      expiresAt: superadminImpersonationSessions.expiresAt,
    })
    .from(superadminImpersonationSessions)
    .where(
      and(
        eq(superadminImpersonationSessions.id, sessionId),
        eq(
          superadminImpersonationSessions.superadminUserId,
          superadminUserId,
        ),
        isNull(superadminImpersonationSessions.endedAt),
        gt(superadminImpersonationSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;
  return row;
}

/**
 * Set the impersonation cookie. Called from `startImpersonationAction`
 * after the DB row has been created.
 */
export function setImpersonationCookie(sessionId: string): void {
  const jar = cookies();
  jar.set(IMPERSONATION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(IMPERSONATION_TTL_MS / 1000),
  });
}

/**
 * Clear the impersonation cookie. Called when the super-admin ends the
 * session, or after the DB row was already ended elsewhere.
 */
export function clearImpersonationCookie(): void {
  const jar = cookies();
  jar.set(IMPERSONATION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
