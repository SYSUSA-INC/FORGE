/**
 * BL-STAB-8a-1 — the second factor's arithmetic, with no database:
 * authenticator (TOTP, RFC 6238) secrets, URIs and verification with a
 * one-step window and replay protection; recovery codes. The store
 * (`mfa-store.ts`) owns the rows; the gate (8a-2) owns the session.
 */
import { generate, generateSecret, generateURI, verify } from "otplib";
import { randomInt } from "node:crypto";

import { MFA_ISSUER, MFA_LIMITS } from "@/lib/mfa-constants";

export { MFA_FACTOR_KINDS, MFA_ISSUER, MFA_LIMITS, type MfaFactorKind } from "@/lib/mfa-constants";

/** Spaces and dashes people type between groups are not part of a code. */
export function normalizeTotpCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** `abcde-fghij`: ten characters from an alphabet without look-alikes. */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateRecoveryCode(): string {
  let out = "";
  for (let i = 0; i < 10; i += 1) out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function generateRecoveryCodes(n = MFA_LIMITS.recoveryCodes): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(generateRecoveryCode());
  return [...set];
}

/** Lower-cased, groups joined by one dash; null unless it has the shape. */
export function normalizeRecoveryCode(input: string): string | null {
  const flat = input.toLowerCase().replace(/[\s-]/g, "");
  if (!/^[a-z0-9]{10}$/.test(flat)) return null;
  return `${flat.slice(0, 5)}-${flat.slice(5)}`;
}

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(input: { secret: string; email: string }): string {
  return generateURI({ issuer: MFA_ISSUER, label: input.email, secret: input.secret });
}

/** For tests and the preview bypass: the code for a secret at a moment. */
export function totpCodeAt(secret: string, epochSeconds: number): Promise<string> {
  return generate({ secret, epoch: epochSeconds });
}

export function totpTimeStep(epochSeconds: number): number {
  return Math.floor(epochSeconds / MFA_LIMITS.totpStepSeconds);
}

/**
 * Verify a code against a secret: one step either side of now, and never
 * a step at or before the last one accepted for this factor (replay).
 * Returns the accepted time step so the caller can store it.
 */
export async function verifyTotp(input: { secret: string; code: string; now?: Date; lastUsedStep?: number | null }): Promise<{ ok: true; timeStep: number } | { ok: false }> {
  const token = normalizeTotpCode(input.code);
  if (!token) return { ok: false };
  const epoch = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const res = await verify({
    secret: input.secret,
    token,
    epoch,
    epochTolerance: MFA_LIMITS.totpToleranceSteps * MFA_LIMITS.totpStepSeconds,
  });
  if (!res.valid) return { ok: false };
  const delta = typeof (res as { delta?: number }).delta === "number" ? (res as { delta: number }).delta : 0;
  const timeStep = totpTimeStep(epoch) + delta;
  if (typeof input.lastUsedStep === "number" && timeStep <= input.lastUsedStep) return { ok: false };
  return { ok: true, timeStep };
}

/** The label a person gives a factor, trimmed to the limit; a default otherwise. */
export function cleanFactorLabel(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, MFA_LIMITS.labelMax);
}

/** BL-STAB-8a-4 — the reason a superadmin writes for a reset: 10 to 500 characters, whitespace collapsed. */
export const MFA_RESET_REASON = { min: 10, max: 500 } as const;
export function cleanResetReason(input: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(input ?? "").replace(/\s+/g, " ").trim();
  if (reason.length < MFA_RESET_REASON.min) return { ok: false, error: `Write a reason of at least ${MFA_RESET_REASON.min} characters: it goes to the person and into the audit log.` };
  if (reason.length > MFA_RESET_REASON.max) return { ok: false, error: `Keep the reason under ${MFA_RESET_REASON.max} characters.` };
  return { ok: true, reason };
}
