import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/db";
import { userMfaFactors, userRecoveryCodes, users } from "@/db/schema";
import { log } from "@/lib/log";
import { cleanFactorLabel, generateRecoveryCodes, MFA_LIMITS, newTotpSecret, normalizeRecoveryCode, totpUri, verifyTotp } from "@/lib/mfa";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { decryptSecret, encryptSecret, SecretBoxError } from "@/lib/secret-box";

/**
 * BL-STAB-8a-1 — the factors and recovery codes of one user. Every
 * query carries the user id. A TOTP secret is stored encrypted with the
 * secret box (purpose `mfa_totp`, the user id as the context) and is
 * decrypted only to verify a code; a recovery code is stored as a hash
 * and shown once.
 */
export type MfaFactorView = {
  id: string;
  kind: string;
  label: string;
  confirmed: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type MfaStatus = {
  factors: MfaFactorView[];
  enrolledAt: Date | null;
  recoveryCodesLeft: number;
  /** FORGE_SECRET_KEYS is set, so secrets can be stored. */
  available: boolean;
};

const SECRET_CTX = (userId: string) => ({ purpose: "mfa_totp" as const, organizationId: userId });

function secretsAvailable(): boolean {
  try {
    encryptSecret("probe", SECRET_CTX("probe"));
    return true;
  } catch (err) {
    return !(err instanceof SecretBoxError);
  }
}

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const [rows, [codes], [u]] = await Promise.all([
    db
      .select({ id: userMfaFactors.id, kind: userMfaFactors.kind, label: userMfaFactors.label, confirmedAt: userMfaFactors.confirmedAt, createdAt: userMfaFactors.createdAt, lastUsedAt: userMfaFactors.lastUsedAt })
      .from(userMfaFactors)
      .where(eq(userMfaFactors.userId, userId))
      .orderBy(asc(userMfaFactors.createdAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(userRecoveryCodes).where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt))),
    db.select({ enrolledAt: users.mfaEnrolledAt }).from(users).where(eq(users.id, userId)).limit(1),
  ]);
  return {
    factors: rows.filter((r) => r.confirmedAt).map((r) => ({ id: r.id, kind: r.kind, label: r.label, confirmed: true, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt })),
    enrolledAt: u?.enrolledAt ?? null,
    recoveryCodesLeft: codes?.n ?? 0,
    available: secretsAvailable(),
  };
}

export async function confirmedFactorCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), isNotNull(userMfaFactors.confirmedAt)));
  return row?.n ?? 0;
}

/**
 * Start an authenticator enrolment: a fresh secret on a pending factor
 * (any earlier pending one is replaced), the otpauth URI and its QR as
 * SVG. Nothing counts until a first code confirms it.
 */
export async function beginTotpEnrolment(input: { userId: string; email: string; label?: unknown }): Promise<{ ok: true; factorId: string; secret: string; uri: string; qrSvg: string } | { ok: false; error: string }> {
  if (!secretsAvailable()) return { ok: false, error: "Two-step sign-in is not available on this deployment yet (FORGE_SECRET_KEYS is not set). Contact your administrator." };
  const confirmed = await confirmedFactorCount(input.userId);
  if (confirmed >= MFA_LIMITS.factors) return { ok: false, error: `You already have ${MFA_LIMITS.factors} factors; remove one first.` };
  const secret = newTotpSecret();
  const { ciphertext, keyId } = encryptSecret(secret, SECRET_CTX(input.userId));
  await db.delete(userMfaFactors).where(and(eq(userMfaFactors.userId, input.userId), isNull(userMfaFactors.confirmedAt)));
  const [row] = await db
    .insert(userMfaFactors)
    .values({ userId: input.userId, kind: "totp", label: cleanFactorLabel(input.label, "Authenticator app"), secretCiphertext: ciphertext, secretKeyId: keyId })
    .returning({ id: userMfaFactors.id });
  const uri = totpUri({ secret, email: input.email });
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 192 });
  return { ok: true, factorId: row!.id, secret, uri, qrSvg };
}

/**
 * A first code proves the app holds the secret: the factor is confirmed,
 * the user counts as enrolled, and the first enrolment mints recovery
 * codes, returned once in clear.
 */
export async function confirmTotpEnrolment(input: { userId: string; factorId: string; code: string }): Promise<{ ok: true; recoveryCodes: string[] | null } | { ok: false; error: string }> {
  const [row] = await db
    .select({ id: userMfaFactors.id, secretCiphertext: userMfaFactors.secretCiphertext, confirmedAt: userMfaFactors.confirmedAt })
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, input.userId), eq(userMfaFactors.id, input.factorId), eq(userMfaFactors.kind, "totp")))
    .limit(1);
  if (!row || row.confirmedAt) return { ok: false, error: "Start the setup again." };
  const secret = decryptSecret(row.secretCiphertext ?? "", SECRET_CTX(input.userId));
  const v = await verifyTotp({ secret, code: input.code });
  if (!v.ok) return { ok: false, error: "That code did not match. Check the app's time is set automatically and try the next code." };
  const now = new Date();
  await db
    .update(userMfaFactors)
    .set({ confirmedAt: now, lastUsedAt: now, lastUsedStep: v.timeStep })
    .where(and(eq(userMfaFactors.userId, input.userId), eq(userMfaFactors.id, row.id)));
  await db.update(users).set({ mfaEnrolledAt: sql`COALESCE(${users.mfaEnrolledAt}, now())`, updatedAt: now }).where(eq(users.id, input.userId));
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, input.userId));
  const recoveryCodes = (existing?.n ?? 0) === 0 ? await mintRecoveryCodes(input.userId) : null;
  return { ok: true, recoveryCodes };
}

async function mintRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => hashPassword(c)));
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  await db.insert(userRecoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
  return codes;
}

/** A fresh batch replaces every earlier code, used or not. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  return mintRecoveryCodes(userId);
}

export async function removeFactor(input: { userId: string; factorId: string }): Promise<{ ok: true; remaining: number } | { ok: false; error: string }> {
  const deleted = await db
    .delete(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, input.userId), eq(userMfaFactors.id, input.factorId)))
    .returning({ id: userMfaFactors.id });
  if (deleted.length === 0) return { ok: false, error: "Factor not found." };
  const remaining = await confirmedFactorCount(input.userId);
  if (remaining === 0) {
    // No factor left: the recovery codes have nothing to recover, and the
    // next sign-in (8a-2) asks the person to enrol again.
    await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, input.userId));
    await db.update(users).set({ mfaEnrolledAt: null, updatedAt: new Date() }).where(eq(users.id, input.userId));
  }
  return { ok: true, remaining };
}

export type CodeCheck = { ok: true; method: "totp" | "recovery"; factorId: string | null; recoveryCodesLeft?: number } | { ok: false };

/**
 * The check every second step and every sensitive change uses: a code
 * from a confirmed authenticator (one step either side, never replayed),
 * else an unused recovery code, which is burned.
 */
export async function verifyUserCode(input: { userId: string; code: string; now?: Date }): Promise<CodeCheck> {
  const factors = await db
    .select({ id: userMfaFactors.id, secretCiphertext: userMfaFactors.secretCiphertext, lastUsedStep: userMfaFactors.lastUsedStep })
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, input.userId), eq(userMfaFactors.kind, "totp"), isNotNull(userMfaFactors.confirmedAt)));
  for (const f of factors) {
    let secret: string;
    try {
      secret = decryptSecret(f.secretCiphertext ?? "", SECRET_CTX(input.userId));
    } catch (err) {
      log.error("[mfa]", "factor secret unreadable", { factorId: f.id, error: err instanceof SecretBoxError ? err.message : err });
      continue;
    }
    const v = await verifyTotp({ secret, code: input.code, now: input.now, lastUsedStep: f.lastUsedStep });
    if (v.ok) {
      await db
        .update(userMfaFactors)
        .set({ lastUsedAt: new Date(), lastUsedStep: v.timeStep })
        .where(and(eq(userMfaFactors.userId, input.userId), eq(userMfaFactors.id, f.id)));
      return { ok: true, method: "totp", factorId: f.id };
    }
  }
  const recovery = normalizeRecoveryCode(input.code);
  if (recovery) {
    const codes = await db
      .select({ id: userRecoveryCodes.id, codeHash: userRecoveryCodes.codeHash })
      .from(userRecoveryCodes)
      .where(and(eq(userRecoveryCodes.userId, input.userId), isNull(userRecoveryCodes.usedAt)));
    for (const c of codes) {
      if (await verifyPassword(recovery, c.codeHash)) {
        const burned = await db
          .update(userRecoveryCodes)
          .set({ usedAt: new Date() })
          .where(and(eq(userRecoveryCodes.id, c.id), eq(userRecoveryCodes.userId, input.userId), isNull(userRecoveryCodes.usedAt)))
          .returning({ id: userRecoveryCodes.id });
        if (burned.length === 0) continue;
        return { ok: true, method: "recovery", factorId: null, recoveryCodesLeft: codes.length - 1 };
      }
    }
  }
  return { ok: false };
}
