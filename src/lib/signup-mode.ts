/**
 * Self-service signup gating.
 *
 * Reads SIGNUP_MODE from env. Three values:
 *
 *   - "open"        — anyone can register; org is auto-provisioned. Was the
 *                     pre-2026-05-03 default. Vulnerable to bot abuse without
 *                     CAPTCHA + rate limiting.
 *
 *   - "invite_only" — DEFAULT. Only the invite path (allowlist + token) can
 *                     register. The self-service /api/register path returns
 *                     403, the /sign-up UI shows an "invite required" notice,
 *                     and OAuth events.createUser deletes the user instead
 *                     of auto-provisioning an org.
 *
 *   - "disabled"    — neither path works; sign-in only.
 *
 * Defaulting to invite_only prevents accidental open-signup regressions if
 * the env var is unset or typo'd.
 */
import "server-only";

export type SignupMode = "open" | "invite_only" | "disabled";

const VALID: SignupMode[] = ["open", "invite_only", "disabled"];

export function getSignupMode(): SignupMode {
  const raw = (process.env.SIGNUP_MODE ?? "").trim().toLowerCase();
  if ((VALID as string[]).includes(raw)) return raw as SignupMode;
  // Unset or invalid → safe default.
  return "invite_only";
}

export function selfServiceRegistrationAllowed(): boolean {
  return getSignupMode() === "open";
}

export function anySignupAllowed(): boolean {
  return getSignupMode() !== "disabled";
}
