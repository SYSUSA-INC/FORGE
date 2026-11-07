/**
 * BL-AUTH-INVITE — the app's public origin and the links we hand out.
 *
 * One place builds every invite / reset URL so the email, the "copy
 * link" button an admin sees and the page that consumes the token all
 * agree. Env-only, no DB; unit-tested.
 */

export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.NEXT_PUBLIC_APP_URL ?? env.AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  // FORGE's address since 2026-11 (owner): https://www.forgeaxi.com. Passkeys belong to
  // this host, so production must never fall back to another domain.
  if (env.VERCEL_ENV === "production") return "https://www.forgeaxi.com";
  const vercel = env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "https://www.forgeaxi.com";
}

/** The sign-up page pre-filled from an invite; consumed by /api/register. */
export function inviteUrl(
  inviteId: string,
  token: string,
  base: string = appBaseUrl(),
): string {
  return `${base}/sign-up?invite=${encodeURIComponent(token)}&id=${encodeURIComponent(inviteId)}`;
}

/** The choose-a-new-password page; consumed by /api/reset-password. */
export function passwordResetUrl(
  email: string,
  token: string,
  base: string = appBaseUrl(),
): string {
  return `${base}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

/** The verify-email landing page. */
export function verifyEmailUrl(
  email: string,
  token: string,
  base: string = appBaseUrl(),
): string {
  return `${base}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}
