"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { unstable_update } from "@/auth";
import { getSessionUser, requireAuth, requireAuthOrPending } from "@/lib/auth-helpers";
import { log } from "@/lib/log";
import { beginTotpEnrolment, confirmTotpEnrolment, regenerateRecoveryCodes, removeFactor, verifyUserCode } from "@/lib/mfa-store";
import { enforceRateLimit, peekRateLimit } from "@/lib/rate-limit";

/**
 * BL-STAB-8a-1 — a person's own second factors. Every action acts on
 * the signed-in user only; a change that weakens the account (removing
 * a factor, replacing the recovery codes) needs a current code first.
 * The audit row lands in the person's current workspace, when they
 * have one.
 */
type Result = { ok: true } | { ok: false; error: string };
const PATH = "/settings/security";

async function audit(action: string, metadata: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) {
    log.info("[mfa]", action, metadata);
    return;
  }
  if (!user.organizationId) {
    log.info("[mfa]", action, { userId: user.id, ...metadata });
    return;
  }
  await recordAudit({ organizationId: user.organizationId, actor: { userId: user.id, email: user.email }, action, resourceType: "user", resourceId: user.id, metadata });
}

/** Five wrong codes in 15 minutes lock these actions, failing closed (8a-0's limiter); right codes do not count. */
const CODE_LIMIT = (userId: string) => ({ key: `mfa-code:${userId}`, limit: 5, windowSeconds: 900, failClosed: true });
async function codeAllowed(userId: string): Promise<boolean> {
  return (await peekRateLimit(CODE_LIMIT(userId))).ok;
}
async function countWrongCode(userId: string): Promise<void> {
  await enforceRateLimit(CODE_LIMIT(userId));
}

export async function beginEnrolmentAction(input: { label?: string }): Promise<{ ok: true; factorId: string; secret: string; uri: string; qrSvg: string } | { ok: false; error: string }> {
  // BL-STAB-8a-2 — a person at the second step with no factor enrols here too.
  const user = await requireAuthOrPending();
  return beginTotpEnrolment({ userId: user.id, email: user.email ?? "", label: input.label });
}

export async function confirmEnrolmentAction(input: { factorId: string; code: string }): Promise<{ ok: true; recoveryCodes: string[] | null } | { ok: false; error: string }> {
  const user = await requireAuthOrPending();
  if (!(await codeAllowed(user.id))) return { ok: false, error: "Too many wrong codes. Wait 15 minutes and try again." };
  const res = await confirmTotpEnrolment({ userId: user.id, factorId: input.factorId, code: input.code });
  if (!res.ok) {
    await countWrongCode(user.id);
    return res;
  }
  if (user.pending) {
    // The first code proved the device: that is the second step, passed.
    await db.update(users).set({ mfaPassPid: user.pending.pid, mfaPassAt: new Date() }).where(eq(users.id, user.id));
    await unstable_update({});
  }
  await audit("user.mfa.enrol", { factorId: input.factorId, kind: "totp", recoveryCodesMinted: !!res.recoveryCodes, atSignIn: !!user.pending });
  revalidatePath(PATH);
  return res;
}

export async function removeFactorAction(input: { factorId: string; code: string }): Promise<Result> {
  const user = await requireAuth();
  if (!(await codeAllowed(user.id))) return { ok: false, error: "Too many wrong codes. Wait 15 minutes and try again." };
  const check = await verifyUserCode({ userId: user.id, code: input.code });
  if (!check.ok) {
    await countWrongCode(user.id);
    return { ok: false, error: "Enter a current code from one of your authenticators (or a recovery code) to remove a factor." };
  }
  const res = await removeFactor({ userId: user.id, factorId: input.factorId });
  if (!res.ok) return res;
  await audit("user.mfa.remove", { factorId: input.factorId, remaining: res.remaining, verifiedWith: check.method });
  revalidatePath(PATH);
  return { ok: true };
}

export async function regenerateRecoveryCodesAction(input: { code: string }): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const user = await requireAuth();
  if (!(await codeAllowed(user.id))) return { ok: false, error: "Too many wrong codes. Wait 15 minutes and try again." };
  const check = await verifyUserCode({ userId: user.id, code: input.code });
  if (!check.ok) {
    await countWrongCode(user.id);
    return { ok: false, error: "Enter a current code from one of your authenticators to replace your recovery codes." };
  }
  const recoveryCodes = await regenerateRecoveryCodes(user.id);
  await audit("user.mfa.recovery_regenerate", { verifiedWith: check.method });
  revalidatePath(PATH);
  return { ok: true, recoveryCodes };
}
