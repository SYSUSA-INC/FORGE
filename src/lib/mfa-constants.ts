/**
 * BL-STAB-8a-1 — the second factor's limits and names, with no Node
 * imports so the Security page's client panel can read them.
 */
export const MFA_ISSUER = "FORGE (sysgov.com)";
export const MFA_LIMITS = {
  /** Authenticator apps and passkeys together, per user. */
  factors: 3,
  recoveryCodes: 10,
  /** One 30-second step either side of now. */
  totpStepSeconds: 30,
  totpToleranceSteps: 1,
  labelMax: 40,
} as const;

export const MFA_FACTOR_KINDS = ["totp", "passkey"] as const;
export type MfaFactorKind = (typeof MFA_FACTOR_KINDS)[number];

export type MfaMethod = "passkey" | "totp";

/**
 * BL-MFA-RECOVERY — what a person still has to add. A platform
 * superadmin keeps two ways in, a passkey and an authenticator app, so
 * one that stops working (a new domain, a lost phone) never locks them
 * out; everyone else needs one. Asked for after sign-in, never as a
 * condition of it: the second step passes with any method they hold.
 */
export function missingMethods(input: { isSuperadmin: boolean; kinds: string[] }): MfaMethod[] {
  const has = (k: MfaMethod) => input.kinds.includes(k);
  if (input.isSuperadmin) return (["passkey", "totp"] as const).filter((k) => !has(k));
  return has("passkey") || has("totp") ? [] : ["passkey"];
}

export const MFA_METHOD_LABELS: Record<MfaMethod, string> = { passkey: "a passkey", totp: "an authenticator app" };
