import { describe, expect, it } from "vitest";
import { cleanFactorLabel, generateRecoveryCodes, MFA_LIMITS, newTotpSecret, normalizeRecoveryCode, normalizeTotpCode, totpCodeAt, totpTimeStep, totpUri, verifyTotp } from "@/lib/mfa";

describe("BL-STAB-8a-1 — codes people type", () => {
  it("accepts six digits with the spaces and dashes apps show, nothing else", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode("123-456")).toBe("123456");
    expect(normalizeTotpCode(" 000000 ")).toBe("000000");
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("1234567")).toBeNull();
    expect(normalizeTotpCode("12345a")).toBeNull();
  });

  it("recovery codes: ten distinct codes without look-alike characters, normalised any way they are typed", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(MFA_LIMITS.recoveryCodes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      expect(c).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{5}-[abcdefghjkmnpqrstuvwxyz23456789]{5}$/);
      expect(normalizeRecoveryCode(c.toUpperCase().replace("-", " "))).toBe(c);
      expect(normalizeRecoveryCode(c.replace("-", ""))).toBe(c);
    }
    expect(normalizeRecoveryCode("abcde-fgh")).toBeNull();
    expect(normalizeRecoveryCode("123456")).toBeNull();
  });

  it("labels are trimmed to the limit with a default", () => {
    expect(cleanFactorLabel("  My   phone ", "Authenticator app")).toBe("My phone");
    expect(cleanFactorLabel("", "Authenticator app")).toBe("Authenticator app");
    expect(cleanFactorLabel("x".repeat(80), "a")).toHaveLength(MFA_LIMITS.labelMax);
  });
});

describe("BL-STAB-8a-1 — the authenticator", () => {
  it("builds an otpauth URI the apps read, naming FORGE and the person", () => {
    const secret = newTotpSecret();
    const uri = totpUri({ secret, email: "ana@example.com" });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("ana%40example.com");
    expect(uri).toContain(`secret=${secret}`);
    expect(decodeURIComponent(uri)).toContain("FORGE (sysgov.com)");
  });

  it("accepts the current code and the steps either side, not two steps away", async () => {
    const secret = newTotpSecret();
    const nowSec = 1_800_000_000;
    const now = new Date(nowSec * 1000);
    expect((await verifyTotp({ secret, code: await totpCodeAt(secret, nowSec), now })).ok).toBe(true);
    expect((await verifyTotp({ secret, code: await totpCodeAt(secret, nowSec - 30), now })).ok).toBe(true);
    expect((await verifyTotp({ secret, code: await totpCodeAt(secret, nowSec + 30), now })).ok).toBe(true);
    const far = await verifyTotp({ secret, code: await totpCodeAt(secret, nowSec - 90), now });
    expect(far.ok).toBe(false);
    expect((await verifyTotp({ secret, code: "000000", now })).ok).toBe(false);
  });

  it("never accepts a step at or before the last one used (replay)", async () => {
    const secret = newTotpSecret();
    const nowSec = 1_800_000_000;
    const now = new Date(nowSec * 1000);
    const code = await totpCodeAt(secret, nowSec);
    const first = await verifyTotp({ secret, code, now });
    expect(first.ok).toBe(true);
    const step = first.ok ? first.timeStep : 0;
    expect(step).toBe(totpTimeStep(nowSec));
    expect((await verifyTotp({ secret, code, now, lastUsedStep: step })).ok).toBe(false);
    // The previous step's code is also refused once this step was used.
    expect((await verifyTotp({ secret, code: await totpCodeAt(secret, nowSec - 30), now, lastUsedStep: step })).ok).toBe(false);
    // The next step's code still works.
    expect((await verifyTotp({ secret, code: await totpCodeAt(secret, nowSec + 30), now, lastUsedStep: step })).ok).toBe(true);
  });
});
