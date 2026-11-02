import { describe, expect, it } from "vitest";
import { checkNewEmail, EMAIL_CHANGE_TTL_MS, normalizeEmail, pendingChangeIsLive } from "@/lib/email-change";

/** BL-STAB-8b-3 — the rules for a change of address. */
describe("checkNewEmail", () => {
  it("accepts a different, well-formed work address, normalised", () => {
    expect(checkNewEmail("old@acme.test", "  New@Acme.test ")).toEqual({ ok: true, email: "new@acme.test" });
  });
  it("refuses the same address, a malformed one and a disposable inbox", () => {
    expect(checkNewEmail("old@acme.test", "OLD@acme.test").ok).toBe(false);
    expect(checkNewEmail("old@acme.test", "not-an-address").ok).toBe(false);
    expect(checkNewEmail("old@acme.test", "x@mailinator.com").ok).toBe(false);
    expect(checkNewEmail("old@acme.test", undefined).ok).toBe(false);
  });
});

describe("pendingChangeIsLive", () => {
  it("is live for 24 hours from the request", () => {
    const at = new Date(1_000_000);
    expect(pendingChangeIsLive(at, 1_000_000 + EMAIL_CHANGE_TTL_MS)).toBe(true);
    expect(pendingChangeIsLive(at, 1_000_000 + EMAIL_CHANGE_TTL_MS + 1)).toBe(false);
    expect(pendingChangeIsLive(null)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims, and treats non-strings as empty", () => {
    expect(normalizeEmail(" A@B.C ")).toBe("a@b.c");
    expect(normalizeEmail(42)).toBe("");
  });
});
