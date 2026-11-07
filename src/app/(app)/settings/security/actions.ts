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
import { beginPasskeyRegistration, finishPasskeyRegistration } from "@/lib/passkeys";
import { checkNewEmail } from "@/lib/email-change";
import { cancelEmailChange, requestEmailChange } from "@/lib/email-change-store";
import { domainRefusesMail, UNDELIVERABLE_MESSAGE } from "@/lib/email-deliverability";
import { emailConfigured, sendEmailChangeConfirmEmail, sendEmailChangeNoticeEmail } from "@/lib/email";
import { enforceRateLimit, peekRateLimit } from "@/lib/rate-limit";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";

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
  // BL-MFA-RECOVERY — any confirmed method passes the step, a
  // superadmin's included; the method they still owe is asked for after.
  if (user.pending) {
    // The first code proved the device: that is the second step, passed.
    await db.update(users).set({ mfaPassPid: user.pending.pid, mfaPassAt: new Date() }).where(eq(users.id, user.id));
    await unstable_update({});
  }
  await audit("user.mfa.enrol", { factorId: input.factorId, kind: "totp", recoveryCodesMinted: !!res.recoveryCodes, atSignIn: !!user.pending });
  revalidatePath(PATH);
  return res;
}

/** BL-STAB-8a-3 — a passkey: the browser's ceremony between these two. */
export async function beginPasskeyRegistrationAction(): Promise<{ ok: true; options: unknown } | { ok: false; error: string }> {
  const user = await requireAuthOrPending();
  return beginPasskeyRegistration({ userId: user.id, email: user.email ?? "" });
}

export async function finishPasskeyRegistrationAction(input: { response: RegistrationResponseJSON; label?: string }): Promise<{ ok: true; recoveryCodes: string[] | null } | { ok: false; error: string }> {
  const user = await requireAuthOrPending();
  const res = await finishPasskeyRegistration({ userId: user.id, response: input.response, label: input.label });
  if (!res.ok) return res;
  if (user.pending) {
    // Registering the key proved possession: the second step, passed.
    await db.update(users).set({ mfaPassPid: user.pending.pid, mfaPassAt: new Date() }).where(eq(users.id, user.id));
    await unstable_update({});
  }
  await audit("user.mfa.enrol", { factorId: res.factorId, kind: "passkey", recoveryCodesMinted: !!res.recoveryCodes, atSignIn: !!user.pending });
  revalidatePath(PATH);
  return { ok: true, recoveryCodes: res.recoveryCodes };
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

/**
 * BL-STAB-8b-3 — a change of address: the new address checked like a
 * sign-up's, a current code (the account's recovery channel moves), then
 * the link to the new inbox and a notice to the old one. Nothing moves
 * until the new inbox clicks.
 */
export async function requestEmailChangeAction(input: { newEmail: string; code: string }): Promise<{ ok: true; pendingEmail: string } | { ok: false; error: string }> {
  const user = await requireAuth();
  const checked = checkNewEmail(user.email, input.newEmail);
  if (!checked.ok) return checked;
  if (!emailConfigured()) return { ok: false, error: "Email is not configured on this deployment, so a new address cannot be confirmed. Ask an administrator." };
  if (!(await codeAllowed(user.id))) return { ok: false, error: "Too many wrong codes. Wait 15 minutes and try again." };
  const check = await verifyUserCode({ userId: user.id, code: input.code });
  if (!check.ok) {
    await countWrongCode(user.id);
    return { ok: false, error: "Enter a current code from one of your authenticators (or a recovery code) to change your address." };
  }
  if (await domainRefusesMail(checked.email)) return { ok: false, error: UNDELIVERABLE_MESSAGE };
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, checked.email)).limit(1);
  if (taken) {
    log.info("[email-change]", "refused: address in use", { userId: user.id });
    return { ok: false, error: "That address can't be used." };
  }
  const { token } = await requestEmailChange({ userId: user.id, newEmail: checked.email });
  try {
    await sendEmailChangeConfirmEmail({ to: checked.email, token, currentEmail: user.email ?? "" });
    if (user.email) await sendEmailChangeNoticeEmail({ to: user.email, newEmail: checked.email, confirmed: false });
  } catch (err) {
    log.error("[email-change]", "emails failed", { userId: user.id, error: err instanceof Error ? err.message : err });
    await cancelEmailChange(user.id);
    return { ok: false, error: "The confirmation email could not be sent. Try again later." };
  }
  await audit("user.email.change_requested", { from: user.email, to: checked.email, verifiedWith: check.method });
  revalidatePath(PATH);
  return { ok: true, pendingEmail: checked.email };
}

export async function cancelEmailChangeAction(): Promise<Result> {
  const user = await requireAuth();
  await cancelEmailChange(user.id);
  await audit("user.email.change_cancelled", {});
  revalidatePath(PATH);
  return { ok: true };
}
