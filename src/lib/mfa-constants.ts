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
