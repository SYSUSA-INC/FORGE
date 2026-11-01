import { describe, expect, it } from "vitest";
import { evaluateSession, gateRedirect, mfaEnforcement, needsRecheck, previewBypassCode, SESSION_POLICY, touchSession } from "@/lib/session-policy";

const T0 = 1_800_000_000_000;
const H = 60 * 60 * 1000;
const ok = { id: "u1", iatMs: T0, lastActive: T0, mfa: "ok" as const, sv: 1, epoch: 0, chk: T0 };

describe("BL-STAB-8a-2 — evaluateSession", () => {
  it("ends a session after 8 hours idle or 24 hours in all, and one from before the policy", () => {
    expect(evaluateSession(ok, T0 + 7 * H)).toBe("ok");
    expect(evaluateSession(ok, T0 + 8 * H + 1)).toBe("idle_expired");
    expect(evaluateSession({ ...ok, lastActive: T0 + 23 * H }, T0 + 23.5 * H)).toBe("ok");
    expect(evaluateSession({ ...ok, lastActive: T0 + 23.9 * H }, T0 + 24 * H + 1)).toBe("absolute_expired");
    expect(evaluateSession({ id: "u1" }, T0)).toBe("malformed");
    expect(evaluateSession({}, T0)).toBe("malformed");
  });

  it("gives the second step ten minutes", () => {
    const pending = { ...ok, mfa: "pending" as const, pendingAt: T0 };
    expect(evaluateSession(pending, T0 + 9 * 60 * 1000)).toBe("ok");
    expect(evaluateSession(pending, T0 + SESSION_POLICY.pendingMs + 1)).toBe("pending_expired");
    expect(evaluateSession({ ...ok, mfa: "enrol" as const }, T0)).toBe("pending_expired");
  });

  it("touches lastActive at most once a minute and re-checks the store once a minute", () => {
    expect(touchSession(ok, T0 + 30_000).lastActive).toBe(T0);
    expect(touchSession(ok, T0 + 61_000).lastActive).toBe(T0 + 61_000);
    expect(needsRecheck(ok, T0 + 30_000)).toBe(false);
    expect(needsRecheck(ok, T0 + 60_000)).toBe(true);
    expect(needsRecheck({ ...ok, chk: undefined }, T0)).toBe(true);
  });
});

describe("BL-STAB-8a-2 — the gate and the switches", () => {
  it("sends a pending session to verify, an unenrolled one to enrol, and leaves the gate pages and the auth API alone", () => {
    expect(gateRedirect("/", "pending")).toBe("/sign-in/verify");
    expect(gateRedirect("/opportunities/1", "enrol")).toBe("/sign-in/enrol");
    expect(gateRedirect("/sign-in/verify", "pending")).toBeNull();
    expect(gateRedirect("/sign-in/enrol", "enrol")).toBeNull();
    expect(gateRedirect("/sign-in/enrol", "pending")).toBe("/sign-in/verify");
    expect(gateRedirect("/sign-in/verify", "enrol")).toBe("/sign-in/enrol");
    expect(gateRedirect("/api/auth/signout", "pending")).toBeNull();
    expect(gateRedirect("/", "ok")).toBeNull();
    expect(gateRedirect("/", undefined)).toBeNull();
  });

  it("enforces unless the switch is off or no keyring exists, and says which", () => {
    expect(mfaEnforcement({ FORGE_SECRET_KEYS: "k1:abc" })).toEqual({ on: true });
    expect(mfaEnforcement({ MFA_ENFORCEMENT: "OFF", FORGE_SECRET_KEYS: "k1:abc" })).toEqual({ on: false, reason: "env_off" });
    expect(mfaEnforcement({})).toEqual({ on: false, reason: "no_secret_keys" });
    expect(mfaEnforcement({ MFA_ENFORCEMENT: "on", FORGE_SECRET_KEYS: "k1:abc" })).toEqual({ on: true });
  });

  it("accepts the preview bypass code only on a preview with a real code", () => {
    expect(previewBypassCode({ VERCEL_ENV: "preview", MFA_PREVIEW_BYPASS_CODE: "letmein-preview" })).toBe("letmein-preview");
    expect(previewBypassCode({ VERCEL_ENV: "production", MFA_PREVIEW_BYPASS_CODE: "letmein-preview" })).toBeNull();
    expect(previewBypassCode({ VERCEL_ENV: "preview", MFA_PREVIEW_BYPASS_CODE: "short" })).toBeNull();
    expect(previewBypassCode({ VERCEL_ENV: "preview" })).toBeNull();
  });
});
