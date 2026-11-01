import { describe, expect, it } from "vitest";
import { cleanResetReason, MFA_RESET_REASON } from "@/lib/mfa";

/** BL-STAB-8a-4 — the reason a superadmin writes for a reset. */
describe("cleanResetReason", () => {
  it("collapses whitespace and keeps a sensible reason", () => {
    const res = cleanResetReason("  Lost phone,\n  identity  confirmed by call ");
    expect(res).toEqual({ ok: true, reason: "Lost phone, identity confirmed by call" });
  });

  it("refuses a reason that is too short, empty or missing", () => {
    expect(cleanResetReason("lost it").ok).toBe(false);
    expect(cleanResetReason("         ").ok).toBe(false);
    expect(cleanResetReason(undefined).ok).toBe(false);
    expect(cleanResetReason(null).ok).toBe(false);
  });

  it("refuses a reason over the limit", () => {
    expect(cleanResetReason("x".repeat(MFA_RESET_REASON.max)).ok).toBe(true);
    expect(cleanResetReason("x".repeat(MFA_RESET_REASON.max + 1)).ok).toBe(false);
  });
});
