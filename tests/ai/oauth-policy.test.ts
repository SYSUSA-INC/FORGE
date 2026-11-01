import { describe, expect, it } from "vitest";
import { decideOAuthSignIn, entraAllowedTenants, OAUTH_ERROR_MESSAGES, oauthErrorParam } from "@/lib/oauth-policy";

const T1 = "11111111-2222-3333-4444-555555555555";
const T2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const base = {
  provider: "google",
  email: "ana@example.com",
  emailVerifiedByProvider: true,
  linkedUser: null,
  userByEmail: null,
  pendingInvite: false,
  signupOpen: false,
};

describe("decideOAuthSignIn (BL-STAB-8a-0)", () => {
  it("lets an attached account in, unless the person is disabled", () => {
    expect(decideOAuthSignIn({ ...base, linkedUser: { id: "u1", disabledAt: null } })).toEqual({ ok: true, how: "linked" });
    expect(decideOAuthSignIn({ ...base, linkedUser: { id: "u1", disabledAt: new Date() } })).toEqual({ ok: false, code: "disabled" });
    // An attached account gets in even when its address is now unverified at the provider.
    expect(decideOAuthSignIn({ ...base, emailVerifiedByProvider: false, linkedUser: { id: "u1", disabledAt: null } })).toEqual({ ok: true, how: "linked" });
  });

  it("never links to an existing account by the address alone; an invite authorises the link", () => {
    const existing = { id: "u2", disabledAt: null };
    expect(decideOAuthSignIn({ ...base, userByEmail: existing })).toEqual({ ok: false, code: "not_linked" });
    expect(decideOAuthSignIn({ ...base, userByEmail: existing, pendingInvite: true })).toEqual({ ok: true, how: "invite_link" });
    // A disabled person is refused on a first link too, invite or not.
    expect(decideOAuthSignIn({ ...base, userByEmail: { id: "u2", disabledAt: new Date() }, pendingInvite: true })).toEqual({ ok: false, code: "disabled" });
  });

  it("creates a stranger's account only through an invite or when sign-up is open", () => {
    expect(decideOAuthSignIn(base)).toEqual({ ok: false, code: "invite_only" });
    expect(decideOAuthSignIn({ ...base, pendingInvite: true })).toEqual({ ok: true, how: "new_account" });
    expect(decideOAuthSignIn({ ...base, signupOpen: true })).toEqual({ ok: true, how: "new_account" });
  });

  it("needs a provider-verified address before any link or creation", () => {
    expect(decideOAuthSignIn({ ...base, emailVerifiedByProvider: false, pendingInvite: true })).toEqual({ ok: false, code: "unverified_email" });
    expect(decideOAuthSignIn({ ...base, email: null, signupOpen: true })).toEqual({ ok: false, code: "unverified_email" });
  });

  it("restricts Microsoft sign-ins to the allow-listed tenants, before anything else", () => {
    const entra = { ...base, provider: "microsoft-entra-id", linkedUser: { id: "u1", disabledAt: null } };
    expect(decideOAuthSignIn({ ...entra, entraTenant: T1, allowedTenants: [T1, T2] })).toEqual({ ok: true, how: "linked" });
    expect(decideOAuthSignIn({ ...entra, entraTenant: T1.toUpperCase(), allowedTenants: [T1] })).toEqual({ ok: true, how: "linked" });
    expect(decideOAuthSignIn({ ...entra, entraTenant: T2, allowedTenants: [T1] })).toEqual({ ok: false, code: "tenant" });
    expect(decideOAuthSignIn({ ...entra, entraTenant: T1, allowedTenants: [] })).toEqual({ ok: false, code: "tenant" });
    expect(decideOAuthSignIn({ ...entra, entraTenant: null, allowedTenants: [T1] })).toEqual({ ok: false, code: "tenant" });
  });

  it("maps every refusal to a sign-in message", () => {
    for (const code of ["disabled", "tenant", "unverified_email", "not_linked", "invite_only"] as const) {
      expect(OAUTH_ERROR_MESSAGES[oauthErrorParam(code)]).toBeTruthy();
    }
  });
});

describe("entraAllowedTenants", () => {
  it("reads the list and the single-tenant issuer, ignores common and junk", () => {
    expect(entraAllowedTenants({ AUTH_MICROSOFT_ENTRA_ID_TENANTS: ` ${T1}, nope ,${T2.toUpperCase()}`, AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/common/v2.0" })).toEqual([T1, T2]);
    expect(entraAllowedTenants({ AUTH_MICROSOFT_ENTRA_ID_ISSUER: `https://login.microsoftonline.com/${T1}/v2.0` })).toEqual([T1]);
    expect(entraAllowedTenants({ AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/organizations/v2.0" })).toEqual([]);
    expect(entraAllowedTenants({})).toEqual([]);
  });
});
