/**
 * BL-MFA-RECOVERY — what a person still has to add. A platform
 * superadmin keeps two ways in (a passkey and an authenticator app);
 * everyone else needs one. The rule is asked for after sign-in, never as
 * a condition of it: the old rule (a superadmin must enrol a passkey
 * before anything opens) locked the owner out when passkeys broke.
 */
import { describe, expect, it } from "vitest";
import { missingMethods } from "@/lib/mfa-constants";

describe("missingMethods", () => {
  it("asks a superadmin for both, then for whichever is missing", () => {
    expect(missingMethods({ isSuperadmin: true, kinds: [] })).toEqual(["passkey", "totp"]);
    expect(missingMethods({ isSuperadmin: true, kinds: ["passkey"] })).toEqual(["totp"]);
    expect(missingMethods({ isSuperadmin: true, kinds: ["totp", "totp"] })).toEqual(["passkey"]);
    expect(missingMethods({ isSuperadmin: true, kinds: ["totp", "passkey"] })).toEqual([]);
  });

  it("asks anyone else for one method, either kind", () => {
    expect(missingMethods({ isSuperadmin: false, kinds: [] })).toEqual(["passkey"]);
    expect(missingMethods({ isSuperadmin: false, kinds: ["totp"] })).toEqual([]);
    expect(missingMethods({ isSuperadmin: false, kinds: ["passkey"] })).toEqual([]);
  });
});
