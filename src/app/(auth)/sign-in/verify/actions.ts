"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { unstable_update } from "@/auth";
import { recordAudit } from "@/lib/audit-log";
import { getPendingSession } from "@/lib/auth-helpers";
import { log } from "@/lib/log";
import { firstWorkspaceOf, verifyUserCode } from "@/lib/mfa-store";
import { enforceRateLimit, peekRateLimit } from "@/lib/rate-limit";
import { previewBypassCode, SESSION_POLICY } from "@/lib/session-policy";

/**
 * BL-STAB-8a-2 — the second step. Only a pending session may call it;
 * five wrong codes lock it for 15 minutes (failing closed); a pass is
 * recorded server-side against the session's pending id and the token
 * is refreshed, which is the only way a session turns to "ok".
 */
export async function verifyMfaCodeAction(input: { code: string }): Promise<{ ok: true; recoveryCodesLeft: number | null } | { ok: false; error: string; locked?: boolean }> {
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

  await db.update(users).set({ mfaPassPid: pending.pid, mfaPassAt: new Date() }).where(eq(users.id, pending.id));
  await unstable_update({});

  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, pending.id)).limit(1);
  log.info("[auth]", "second step passed", { userId: pending.id, amr });
  // The workspace is not on the pending session; the audit row goes to
  // the person's first active membership when they have one.
  try {
    const organizationId = await firstWorkspaceOf(pending.id);
    if (organizationId) {
      await recordAudit({ organizationId, actor: { userId: pending.id, email: me?.email }, action: "auth.mfa.verified", resourceType: "user", resourceId: pending.id, metadata: { amr, recoveryCodesLeft } });
    }
  } catch (err) {
    log.warn("[auth]", "mfa audit failed", { error: err });
  }
  return { ok: true, recoveryCodesLeft };
}
