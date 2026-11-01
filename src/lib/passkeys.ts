import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/types";
import { db } from "@/db";
import { userMfaFactors, users } from "@/db/schema";
import { log } from "@/lib/log";
import { cleanFactorLabel, MFA_LIMITS } from "@/lib/mfa";
import { confirmedFactorCount, ensureRecoveryCodes } from "@/lib/mfa-store";
import { expectedOrigins, WEBAUTHN_CHALLENGE_MS, webauthnConfig } from "@/lib/webauthn";

/**
 * BL-STAB-8a-3 — passkeys (WebAuthn) as a second factor beside the
 * authenticator app. The credential's id, public key, counter and
 * transports live on `user_mfa_factor` (kind `passkey`); one challenge
 * at a time per user, on the user row, good for five minutes. Every
 * query carries the user id.
 */
type PasskeyRow = { id: string; label: string; credentialId: string | null; publicKey: string | null; counter: number; transports: string[] };

async function passkeysOf(userId: string): Promise<PasskeyRow[]> {
  return db
    .select({ id: userMfaFactors.id, label: userMfaFactors.label, credentialId: userMfaFactors.credentialId, publicKey: userMfaFactors.publicKey, counter: userMfaFactors.counter, transports: userMfaFactors.transports })
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.kind, "passkey"), isNotNull(userMfaFactors.confirmedAt)));
}

/** A platform superadmin must hold a passkey (8a-3): true while they have none. */
export async function superadminNeedsPasskey(userId: string): Promise<boolean> {
  const [row] = await db.select({ isSuperadmin: users.isSuperadmin }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row?.isSuperadmin) return false;
  return (await passkeyCount(userId)) === 0;
}

export async function passkeyCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.kind, "passkey"), isNotNull(userMfaFactors.confirmedAt)));
  return row?.n ?? 0;
}

async function storeChallenge(userId: string, challenge: string): Promise<void> {
  await db.update(users).set({ webauthnChallenge: challenge, webauthnChallengeAt: new Date() }).where(eq(users.id, userId));
}

/** The stored challenge, consumed: null when none or older than five minutes. */
async function takeChallenge(userId: string): Promise<string | null> {
  const [row] = await db.select({ c: users.webauthnChallenge, at: users.webauthnChallengeAt }).from(users).where(eq(users.id, userId)).limit(1);
  await db.update(users).set({ webauthnChallenge: null, webauthnChallengeAt: null }).where(eq(users.id, userId));
  if (!row?.c || !row.at || Date.now() - row.at.getTime() > WEBAUTHN_CHALLENGE_MS) return null;
  return row.c;
}

export async function beginPasskeyRegistration(input: { userId: string; email: string }): Promise<{ ok: true; options: PublicKeyCredentialCreationOptionsJSON } | { ok: false; error: string }> {
  if ((await confirmedFactorCount(input.userId)) >= MFA_LIMITS.factors) return { ok: false, error: `You already have ${MFA_LIMITS.factors} factors; remove one first.` };
  const cfg = webauthnConfig();
  const existing = await passkeysOf(input.userId);
  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpID,
    userID: input.userId,
    userName: input.email,
    attestationType: "none",
    excludeCredentials: existing.filter((p) => p.credentialId).map((p) => ({ id: isoBase64URL.toBuffer(p.credentialId!), type: "public-key" as const, transports: p.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await storeChallenge(input.userId, options.challenge);
  return { ok: true, options };
}

export async function finishPasskeyRegistration(input: { userId: string; response: RegistrationResponseJSON; label?: unknown }): Promise<{ ok: true; factorId: string; recoveryCodes: string[] | null } | { ok: false; error: string }> {
  const expectedChallenge = await takeChallenge(input.userId);
  if (!expectedChallenge) return { ok: false, error: "The passkey request expired. Start again." };
  const cfg = webauthnConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response: input.response, expectedChallenge, expectedOrigin: expectedOrigins(cfg), expectedRPID: cfg.rpID, requireUserVerification: false });
  } catch (err) {
    log.warn("[passkeys]", "registration refused", { userId: input.userId, error: err instanceof Error ? err.message : err });
    return { ok: false, error: "That passkey could not be verified. Try again." };
  }
  if (!verification.verified || !verification.registrationInfo) return { ok: false, error: "That passkey could not be verified. Try again." };
  const info = verification.registrationInfo;
  const now = new Date();
  const [row] = await db
    .insert(userMfaFactors)
    .values({
      userId: input.userId,
      kind: "passkey",
      label: cleanFactorLabel(input.label, "Passkey"),
      credentialId: isoBase64URL.fromBuffer(info.credentialID),
      publicKey: isoBase64URL.fromBuffer(info.credentialPublicKey),
      counter: info.counter,
      transports: input.response.response.transports ?? [],
      confirmedAt: now,
      lastUsedAt: now,
    })
    .returning({ id: userMfaFactors.id });
  await db.update(users).set({ mfaEnrolledAt: sql`COALESCE(${users.mfaEnrolledAt}, now())`, updatedAt: now }).where(eq(users.id, input.userId));
  const recoveryCodes = await ensureRecoveryCodes(input.userId);
  return { ok: true, factorId: row!.id, recoveryCodes };
}

export async function beginPasskeyAuthentication(input: { userId: string }): Promise<{ ok: true; options: PublicKeyCredentialRequestOptionsJSON } | { ok: false; error: string }> {
  const keys = (await passkeysOf(input.userId)).filter((p) => p.credentialId);
  if (keys.length === 0) return { ok: false, error: "No passkey on this account." };
  const cfg = webauthnConfig();
  const options = await generateAuthenticationOptions({
    rpID: cfg.rpID,
    userVerification: "preferred",
    allowCredentials: keys.map((p) => ({ id: isoBase64URL.toBuffer(p.credentialId!), type: "public-key" as const, transports: p.transports as AuthenticatorTransportFuture[] })),
  });
  await storeChallenge(input.userId, options.challenge);
  return { ok: true, options };
}

export async function finishPasskeyAuthentication(input: { userId: string; response: AuthenticationResponseJSON }): Promise<{ ok: true; factorId: string } | { ok: false; error: string }> {
  const expectedChallenge = await takeChallenge(input.userId);
  if (!expectedChallenge) return { ok: false, error: "The passkey request expired. Start again." };
  const key = (await passkeysOf(input.userId)).find((p) => p.credentialId === input.response.id);
  if (!key?.credentialId || !key.publicKey) return { ok: false, error: "That passkey is not on this account." };
  const cfg = webauthnConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: expectedOrigins(cfg),
      expectedRPID: cfg.rpID,
      requireUserVerification: false,
      authenticator: { credentialID: isoBase64URL.toBuffer(key.credentialId), credentialPublicKey: isoBase64URL.toBuffer(key.publicKey), counter: key.counter, transports: key.transports as AuthenticatorTransportFuture[] },
    });
  } catch (err) {
    log.warn("[passkeys]", "sign-in refused", { userId: input.userId, error: err instanceof Error ? err.message : err });
    return { ok: false, error: "That passkey could not be verified. Try again." };
  }
  if (!verification.verified) return { ok: false, error: "That passkey could not be verified. Try again." };
  await db
    .update(userMfaFactors)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(and(eq(userMfaFactors.userId, input.userId), eq(userMfaFactors.id, key.id)));
  return { ok: true, factorId: key.id };
}
