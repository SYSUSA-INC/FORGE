import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailConfigured, sendMfaRecoveryLinkEmail, sendMfaRecoveryUsedEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * BL-MFA-RECOVERY — the way back for someone at the second step who can
 * use neither their passkey nor their authenticator app and has no
 * recovery code, without waiting for another administrator (owner,
 * 2026-11-07: "if I cannot fix it then no one can as I am super admin").
 *
 * A single-use link to the person's verified address, good for 15
 * minutes, three a day. It works only in a session that has already
 * passed the password (or Google / Microsoft) step for the same person,
 * so the email alone is not enough. Only its SHA-256 is stored; using it
 * clears it. The person and every platform superadmin are told it was
 * used. Every query carries the user id.
 */
export const RECOVERY_LINK_MINUTES = 15;
export const RECOVERY_LINKS_PER_DAY = 3;

export function hashRecoveryToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issueRecoveryLink(input: { userId: string; origin: string }): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const [u] = await db.select({ email: users.email, emailVerified: users.emailVerified, disabledAt: users.disabledAt }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!u?.email || !u.emailVerified || u.disabledAt) return { ok: false, error: "A recovery link can't be sent for this account. Ask an administrator to reset your two-step sign-in." };
  if (!emailConfigured()) return { ok: false, error: "FORGE can't send email on this deployment yet. Use a recovery code, or ask an administrator to reset your two-step sign-in." };
  const limit = await enforceRateLimit({ key: `mfa-recovery-link:${input.userId}`, limit: RECOVERY_LINKS_PER_DAY, windowSeconds: 86_400, failClosed: true });
  if (!limit.ok) return { ok: false, error: `You have asked for ${RECOVERY_LINKS_PER_DAY} recovery links today. Use the latest one, a recovery code, or ask an administrator.` };
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db
    .update(users)
    .set({ mfaRecoveryTokenHash: hashRecoveryToken(token), mfaRecoveryExpiresAt: new Date(now.getTime() + RECOVERY_LINK_MINUTES * 60_000), mfaRecoverySentAt: now })
    .where(eq(users.id, input.userId));
  const url = `${input.origin.replace(/\/+$/, "")}/sign-in/verify?recover=${encodeURIComponent(token)}`;
  try {
    await sendMfaRecoveryLinkEmail({ to: u.email, url, minutes: RECOVERY_LINK_MINUTES });
  } catch (err) {
    log.warn("[mfa]", "recovery link email failed", { userId: input.userId, error: err instanceof Error ? err.message : err });
    return { ok: false, error: "The email could not be sent. Try again in a minute, or use a recovery code." };
  }
  return { ok: true, sentTo: maskEmail(u.email) };
}

/** Uses the link: true once, for the person it was sent to, while it is fresh; it is cleared either way it matches. */
export async function redeemRecoveryLink(input: { userId: string; token: string; now?: Date }): Promise<boolean> {
  const token = (input.token ?? "").trim();
  if (!token || token.length > 200) return false;
  const [row] = await db
    .update(users)
    .set({ mfaRecoveryTokenHash: null, mfaRecoveryExpiresAt: null })
    .where(and(eq(users.id, input.userId), eq(users.mfaRecoveryTokenHash, hashRecoveryToken(token)), gt(users.mfaRecoveryExpiresAt, input.now ?? new Date())))
    .returning({ id: users.id });
  return !!row;
}

/** Tells the person and every active platform superadmin that a recovery link was used. Never throws. */
export async function announceRecoveryLinkUsed(userId: string, at: Date = new Date()): Promise<void> {
  try {
    const [me] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me?.email) return;
    const when = at.toISOString().slice(0, 16).replace("T", " ");
    const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.isSuperadmin, true), isNull(users.disabledAt)));
    await sendMfaRecoveryUsedEmail({ to: me.email, who: me.name || me.email, at: when, self: true });
    for (const a of admins) {
      if (a.email && a.email !== me.email) await sendMfaRecoveryUsedEmail({ to: a.email, who: me.name ? `${me.name} (${me.email})` : me.email, at: when, self: false });
    }
  } catch (err) {
    log.warn("[mfa]", "recovery link notice failed", { userId, error: err instanceof Error ? err.message : err });
  }
}

/** "m•••@sysusa.com" — enough to recognise the inbox, not to read the address off the screen. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  return `${email[0]}•••${email.slice(at)}`;
}
