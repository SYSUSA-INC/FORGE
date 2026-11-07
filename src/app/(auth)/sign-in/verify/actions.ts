"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { unstable_update } from "@/auth";
import { recordAudit } from "@/lib/audit-log";
import { getPendingSession } from "@/lib/auth-helpers";
import { log } from "@/lib/log";
import { firstWorkspaceOf, missingMethodsOf, verifyUserCode } from "@/lib/mfa-store";
import { announceRecoveryLinkUsed, issueRecoveryLink, redeemRecoveryLink } from "@/lib/mfa-recovery";
import { passkeyConfigHere } from "@/lib/request-host";
import { beginPasskeyAuthentication, finishPasskeyAuthentication } from "@/lib/passkeys";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import { enforceRateLimit, peekRateLimit } from "@/lib/rate-limit";
import { previewBypassCode, SESSION_POLICY } from "@/lib/session-policy";

/**
 * BL-STAB-8a-2 — the second step. Only a pending session may call it;
 * five wrong codes lock it for 15 minutes (failing closed); a pass is
 * recorded server-side against the session's pending id and the token
 * is refreshed, which is the only way a session turns to "ok".
 */
export async function verifyMfaCodeAction(input: { code: string }): Promise<{ ok: true; recoveryCodesLeft: number | null; next: string | null } | { ok: false; error: string; locked?: boolean }> {
  const pending = await getPendingSession();
  if (!pending) return { ok: false, error: "Sign in again." };
  if (pending.mfa === "enrol") return { ok: false, error: "Set up an authenticator first." };

  // Wrong codes count, right ones do not: peek first, add on failure.
  const limitOpts = { key: `mfa-code:${pending.id}`, limit: SESSION_POLICY.lockAttempts, windowSeconds: SESSION_POLICY.lockWindowSeconds, failClosed: true };
  const limit = await peekRateLimit(limitOpts);
  if (!limit.ok) {
    log.warn("[auth]", "second step locked", { userId: pending.id });
    return { ok: false, error: "Too many wrong codes. Wait 15 minutes, then sign in again.", locked: true };
  }

  const code = (input.code ?? "").trim();
  const bypass = previewBypassCode({ VERCEL_ENV: process.env.VERCEL_ENV, MFA_PREVIEW_BYPASS_CODE: process.env.MFA_PREVIEW_BYPASS_CODE });
  let amr: "code" | "recovery" | "preview";
  let recoveryCodesLeft: number | null = null;
  if (bypass && code === bypass) {
    amr = "preview";
  } else {
    const check = await verifyUserCode({ userId: pending.id, code });
    if (!check.ok) {
      const counted = await enforceRateLimit(limitOpts);
      return { ok: false, error: "That code did not match. Try the next one the app shows, or a recovery code.", locked: !counted.ok };
    }
    amr = check.method === "totp" ? "code" : "recovery";
    recoveryCodesLeft = check.recoveryCodesLeft ?? null;
  }

  await passSecondStep(pending.id, pending.pid, amr, recoveryCodesLeft);
  return { ok: true, recoveryCodesLeft, next: await afterPass(pending.id) };
}

/** BL-MFA-RECOVERY — where to go after the step: Security when a method is still owed (a superadmin keeps two). */
async function afterPass(userId: string): Promise<string | null> {
  try {
    return (await missingMethodsOf(userId)).length > 0 ? "/settings/security" : null;
  } catch {
    return null;
  }
}

/**
 * BL-MFA-RECOVERY — "Email me a recovery link": for a person at the
 * second step whose passkey and app can't be used. The link comes back to
 * this page on the address they are on, and works only in this session.
 */
export async function sendRecoveryLinkAction(): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const pending = await getPendingSession();
  if (!pending || pending.mfa !== "pending") return { ok: false, error: "Sign in again." };
  const res = await issueRecoveryLink({ userId: pending.id, origin: passkeyConfigHere().origin });
  if (res.ok) await auditStep(pending.id, "auth.mfa.recovery_link_sent", {});
  return res;
}

export async function redeemRecoveryLinkAction(input: { token: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const pending = await getPendingSession();
  if (!pending) return { ok: false, error: "Sign in with your password first, in this browser, then open the link again." };
  if (pending.mfa !== "pending") return { ok: false, error: "There is nothing to recover: set up your second step below." };
  const limitOpts = { key: `mfa-code:${pending.id}`, limit: SESSION_POLICY.lockAttempts, windowSeconds: SESSION_POLICY.lockWindowSeconds, failClosed: true };
  if (!(await peekRateLimit(limitOpts)).ok) return { ok: false, error: "Too many failed attempts. Wait 15 minutes, then sign in again." };
  if (!(await redeemRecoveryLink({ userId: pending.id, token: String(input?.token ?? "") }))) {
    await enforceRateLimit(limitOpts);
    return { ok: false, error: "That recovery link has expired or was already used. Ask for a new one below." };
  }
  await passSecondStep(pending.id, pending.pid, "recovery_link", null);
  await announceRecoveryLinkUsed(pending.id);
  return { ok: true };
}

/** The pass marker for this pending id, the token refresh, the audit row. */
async function passSecondStep(userId: string, pid: string, amr: string, recoveryCodesLeft: number | null): Promise<void> {
  await db.update(users).set({ mfaPassPid: pid, mfaPassAt: new Date() }).where(eq(users.id, userId));
  await unstable_update({});
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  log.info("[auth]", "second step passed", { userId, amr });
  await auditStep(userId, "auth.mfa.verified", { amr, recoveryCodesLeft }, me?.email);
}

/**
 * The workspace is not on the pending session; the audit row goes to the
 * person's first active membership when they have one (logged when not).
 */
async function auditStep(userId: string, action: string, metadata: Record<string, unknown>, email?: string | null): Promise<void> {
  try {
    const organizationId = await firstWorkspaceOf(userId);
    if (organizationId) {
      await recordAudit({ organizationId, actor: { userId, email: email ?? null }, action, resourceType: "user", resourceId: userId, metadata });
    } else {
      log.info("[auth]", action, { userId, ...metadata });
    }
  } catch (err) {
    log.warn("[auth]", "mfa audit failed", { error: err });
  }
}

/** BL-STAB-8a-3 — the passkey route through the second step. */
export async function beginPasskeySignInAction(): Promise<{ ok: true; options: unknown } | { ok: false; error: string }> {
  const pending = await getPendingSession();
  if (!pending || pending.mfa !== "pending") return { ok: false, error: "Sign in again." };
  return beginPasskeyAuthentication({ userId: pending.id });
}

export async function finishPasskeySignInAction(input: { response: AuthenticationResponseJSON }): Promise<{ ok: true; next: string | null } | { ok: false; error: string }> {
  const pending = await getPendingSession();
  if (!pending || pending.mfa !== "pending") return { ok: false, error: "Sign in again." };
  const limitOpts = { key: `mfa-code:${pending.id}`, limit: SESSION_POLICY.lockAttempts, windowSeconds: SESSION_POLICY.lockWindowSeconds, failClosed: true };
  if (!(await peekRateLimit(limitOpts)).ok) return { ok: false, error: "Too many failed attempts. Wait 15 minutes, then sign in again." };
  const res = await finishPasskeyAuthentication({ userId: pending.id, response: input.response });
  if (!res.ok) {
    await enforceRateLimit(limitOpts);
    return res;
  }
  await passSecondStep(pending.id, pending.pid, "passkey", null);
  return { ok: true, next: await afterPass(pending.id) };
}
