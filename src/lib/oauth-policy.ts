/**
 * BL-STAB-8 — 8a-0: the rule for a Google / Microsoft sign-in, pure so
 * it is tested without Auth.js or the database.
 *
 * Owner decision (2026-10-23): no linking by email alone. An OAuth
 * sign-in gets in when the provider account is already attached to a
 * FORGE account; it may attach to an existing account with the same
 * verified address only through a pending invite; a stranger gets a
 * new account only when self-service sign-up is open; and Microsoft
 * sign-ins must come from an allow-listed tenant.
 */
export type OAuthDecisionInput = {
  provider: string;
  /** The provider proved this address (Google's `email_verified`, Entra's token). */
  email: string | null;
  emailVerifiedByProvider: boolean;
  /** The FORGE user this provider account is already attached to, if any. */
  linkedUser: { id: string; disabledAt: Date | null } | null;
  /** The FORGE user with the same address, if any (for the link decision). */
  userByEmail: { id: string; disabledAt: Date | null } | null;
  /** A pending, non-revoked, approved invite for the address exists. */
  pendingInvite: boolean;
  /** SIGNUP_MODE=open. */
  signupOpen: boolean;
  /** Microsoft only: the token's tenant (`tid`) and the tenants allowed. */
  entraTenant?: string | null;
  allowedTenants?: string[];
};

export type OAuthDecision =
  | { ok: true; how: "linked" | "invite_link" | "new_account" }
  | { ok: false; code: "disabled" | "tenant" | "unverified_email" | "not_linked" | "invite_only" };

export const ENTRA_PROVIDER = "microsoft-entra-id";

export function decideOAuthSignIn(i: OAuthDecisionInput): OAuthDecision {
  if (i.provider === ENTRA_PROVIDER) {
    const allowed = (i.allowedTenants ?? []).map((t) => t.toLowerCase());
    const tenant = (i.entraTenant ?? "").toLowerCase();
    if (allowed.length === 0 || !tenant || !allowed.includes(tenant)) return { ok: false, code: "tenant" };
  }
  if (i.linkedUser) {
    return i.linkedUser.disabledAt ? { ok: false, code: "disabled" } : { ok: true, how: "linked" };
  }
  if (!i.email || !i.emailVerifiedByProvider) return { ok: false, code: "unverified_email" };
  if (i.userByEmail) {
    if (i.userByEmail.disabledAt) return { ok: false, code: "disabled" };
    // The invite authorises the link; the address alone does not.
    return i.pendingInvite ? { ok: true, how: "invite_link" } : { ok: false, code: "not_linked" };
  }
  if (i.pendingInvite || i.signupOpen) return { ok: true, how: "new_account" };
  return { ok: false, code: "invite_only" };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Entra tenants allowed to sign in: `AUTH_MICROSOFT_ENTRA_ID_TENANTS`
 * (comma-separated tenant ids) plus the tenant named in the issuer URL
 * when it is one tenant rather than `common` or `organizations`.
 */
export function entraAllowedTenants(env: { AUTH_MICROSOFT_ENTRA_ID_TENANTS?: string; AUTH_MICROSOFT_ENTRA_ID_ISSUER?: string }): string[] {
  const out = new Set<string>();
  for (const t of (env.AUTH_MICROSOFT_ENTRA_ID_TENANTS ?? "").split(",")) {
    const v = t.trim().toLowerCase();
    if (GUID.test(v)) out.add(v);
  }
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? "";
  const m = issuer.match(/login\.microsoftonline\.com\/([^/]+)/i);
  if (m && GUID.test(m[1]!)) out.add(m[1]!.toLowerCase());
  return [...out];
}

/** The query value the sign-in page shows a message for. */
export function oauthErrorParam(code: Exclude<OAuthDecision, { ok: true }>["code"]): string {
  return `oauth_${code}`;
}

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_disabled: "This account is disabled. Contact your administrator.",
  oauth_tenant: "Your Microsoft organization is not set up for FORGE. Ask your administrator to allow it.",
  oauth_unverified_email: "Your sign-in provider has not verified this email address. Verify it there, then try again.",
  oauth_not_linked: "This email already has a FORGE account. Sign in with your password instead.",
  oauth_invite_only: "FORGE is invitation-only. Ask your organization's administrator to invite you.",
};
