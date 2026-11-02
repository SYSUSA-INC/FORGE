import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { EMAIL_CHANGE_TTL_MS, pendingChangeIsLive } from "@/lib/email-change";
import { log } from "@/lib/log";
import { consumeToken, issueToken } from "@/lib/tokens";

/**
 * BL-STAB-8b-3 — the change of address, server side. One pending change
 * per user, on the user row; the token is keyed by the new address, so
 * the link proves that inbox. Every write is keyed by the user id.
 */
export async function pendingEmailChange(userId: string): Promise<{ email: string; requestedAt: Date } | null> {
  const [row] = await db.select({ email: users.pendingEmail, at: users.pendingEmailAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row?.email || !pendingChangeIsLive(row.at)) return null;
  return { email: row.email, requestedAt: row.at! };
}

/** Record the pending change and mint the link's token (sent by the caller). */
export async function requestEmailChange(input: { userId: string; newEmail: string }): Promise<{ token: string }> {
  await db.update(users).set({ pendingEmail: input.newEmail, pendingEmailAt: new Date(), updatedAt: new Date() }).where(eq(users.id, input.userId));
  const token = await issueToken("change-email", input.newEmail);
  return { token };
}

export async function cancelEmailChange(userId: string): Promise<void> {
  await db.update(users).set({ pendingEmail: null, pendingEmailAt: null, updatedAt: new Date() }).where(eq(users.id, userId));
}

/**
 * The link from the new inbox: the address moves, is verified, and every
 * session of the person ends (they sign in again with the new address).
 * Refused when the link is spent or stale, the change was cancelled, or
 * the address was taken meanwhile.
 */
export async function confirmEmailChange(input: { email: string; token: string }): Promise<{ ok: true; userId: string; oldEmail: string; newEmail: string } | { ok: false; reason: "invalid" | "stale" | "taken" }> {
  const email = input.email.trim().toLowerCase();
  if (!(await consumeToken("change-email", email, input.token))) return { ok: false, reason: "invalid" };
  const [row] = await db.select({ id: users.id, email: users.email, at: users.pendingEmailAt }).from(users).where(eq(users.pendingEmail, email)).limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  if (!pendingChangeIsLive(row.at)) {
    await cancelEmailChange(row.id);
    return { ok: false, reason: "stale" };
  }
  try {
    const updated = await db
      .update(users)
      .set({
        email,
        emailVerified: new Date(),
        pendingEmail: null,
        pendingEmailAt: null,
        // BL-STAB-8a-2 — the account's recovery channel moved: every session ends.
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, row.id), eq(users.pendingEmail, email)))
      .returning({ id: users.id });
    if (updated.length === 0) return { ok: false, reason: "invalid" };
  } catch (err) {
    // The unique index on user.email: someone took the address meanwhile.
    log.warn("[email-change]", "confirmation refused: address taken", { userId: row.id, error: err instanceof Error ? err.message : err });
    await cancelEmailChange(row.id);
    return { ok: false, reason: "taken" };
  }
  return { ok: true, userId: row.id, oldEmail: row.email, newEmail: email };
}

export { EMAIL_CHANGE_TTL_MS };
