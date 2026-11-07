/**
 * BL-MFA-ADMIN — a company admin's view of members' two-step sign-in, and
 * whom they may reset. Pure.
 */
import { describe, expect, it } from "vitest";
import { companyResetBlocker, memberState, methodsLabel, type MemberSecurityInput } from "@/lib/company-security-logic";

const m = (over: Partial<MemberSecurityInput> = {}): MemberSecurityInput => ({ userId: "u1", isSuperadmin: false, status: "active", passkeys: 1, apps: 0, enrolled: true, otherWorkspaces: 0, ...over });

describe("member security", () => {
  it("says what each member holds", () => {
    expect(methodsLabel(m())).toBe("Passkey");
    expect(methodsLabel(m({ passkeys: 2, apps: 1 }))).toBe("Passkey ×2 · App");
    expect(methodsLabel(m({ passkeys: 0, apps: 0, enrolled: false }))).toBe("Not set up yet");
    expect(memberState(m({ passkeys: 0, apps: 0 }))).toBe("not_set_up");
  });

  it("lets a company admin reset only an active member of theirs alone, never themselves or a platform admin", () => {
    expect(companyResetBlocker("admin", m())).toBeNull();
    expect(companyResetBlocker("u1", m())).toMatch(/your own/);
    expect(companyResetBlocker("admin", m({ isSuperadmin: true }))).toMatch(/platform administrator/);
    expect(companyResetBlocker("admin", m({ otherWorkspaces: 1 }))).toMatch(/another company/);
    expect(companyResetBlocker("admin", m({ status: "disabled" }))).toMatch(/active/);
    expect(companyResetBlocker("admin", m({ passkeys: 0, apps: 0, enrolled: false }))).toMatch(/Nothing to reset/);
  });
});
