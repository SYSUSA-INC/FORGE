/**
 * BL-STAB-7b — secrets at rest and the rules for a company's SAM.gov key
 * (pure): AES-256-GCM bound to purpose, organization and key id; tamper
 * and copy detection; keyring parsing, rotation and the preview refusal;
 * key-shape checks and what each test-search answer means for saving.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretBoxError, canDecryptKeyId, decryptSecret, encryptSecret, keyringStatus } from "@/lib/secret-box";
import { refusedMessage, saveOutcome, savedMessage, validateSamKeyInput } from "@/lib/samgov-key-logic";

const k = () => randomBytes(32).toString("base64");
const K1 = k();
const K2 = k();
const ENV = { FORGE_SECRET_KEYS: `k1:${K1}`, VERCEL_ENV: "production" };
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ctxA = { purpose: "samgov_api_key" as const, organizationId: ORG_A };
const SECRET = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789wxyz";

function reason(fn: () => unknown): string {
  try {
    fn();
    return "none";
  } catch (err) {
    return err instanceof SecretBoxError ? err.reason : String(err);
  }
}

function flip(ciphertext: string, part: number): string {
  const parts = ciphertext.split(".");
  const bytes = Buffer.from(parts[part]!, "base64url");
  bytes[0] = bytes[0]! ^ 1;
  parts[part] = bytes.toString("base64url");
  return parts.join(".");
}

describe("BL-STAB-7b — secret box", () => {
  it("round-trips, and the stored form never holds the secret", () => {
    const { ciphertext, keyId } = encryptSecret(SECRET, ctxA, ENV);
    expect(keyId).toBe("k1");
    expect(ciphertext).toMatch(/^fsb1\.k1\./);
    expect(ciphertext).not.toContain(SECRET);
    expect(decryptSecret(ciphertext, ctxA, ENV)).toBe(SECRET);
    const ivs = new Set(Array.from({ length: 1000 }, () => encryptSecret(SECRET, ctxA, ENV).ciphertext.split(".")[2]));
    expect(ivs.size).toBe(1000);
  });

  it("refuses another organization, another purpose's binding, tampering and short tags", () => {
    const { ciphertext } = encryptSecret(SECRET, ctxA, ENV);
    expect(reason(() => decryptSecret(ciphertext, { ...ctxA, organizationId: ORG_B }, ENV))).toBe("auth_failed");
    for (const part of [2, 3, 4]) expect(reason(() => decryptSecret(flip(ciphertext, part), ctxA, ENV))).toBe("auth_failed");
    const parts = ciphertext.split(".");
    parts[3] = Buffer.from(parts[3]!, "base64url").subarray(0, 12).toString("base64url");
    expect(reason(() => decryptSecret(parts.join("."), ctxA, ENV))).toBe("malformed");
    expect(reason(() => decryptSecret("not-a-secret", ctxA, ENV))).toBe("malformed");
    expect(reason(() => decryptSecret(ciphertext.replace(".k1.", ".k9."), ctxA, ENV))).toBe("unknown_key");
  });

  it("parses the keyring strictly, rotates, and refuses previews", () => {
    expect(keyringStatus({ FORGE_SECRET_KEYS: `k2:${K2},k1:${K1}` })).toEqual({ available: true, primaryKeyId: "k2", keyIds: ["k2", "k1"], problem: null });
    for (const bad of [`k1:${K1},k1:${K2}`, `k1:${randomBytes(31).toString("base64")}`, `K1:${K1}`, `k1${K1}`, ""]) {
      const status = keyringStatus({ FORGE_SECRET_KEYS: bad });
      expect(status.available, bad).toBe(false);
      expect(status.problem ?? "").not.toContain(K1.slice(0, 12));
    }
    const old = encryptSecret(SECRET, ctxA, ENV).ciphertext;
    const rotated = { FORGE_SECRET_KEYS: `k2:${K2},k1:${K1}` };
    expect(decryptSecret(old, ctxA, rotated)).toBe(SECRET);
    expect(encryptSecret(SECRET, ctxA, rotated).keyId).toBe("k2");
    expect(canDecryptKeyId("k1", rotated)).toBe(true);
    expect(canDecryptKeyId("k1", { FORGE_SECRET_KEYS: `k2:${K2}` })).toBe(false);

    const preview = { ...ENV, VERCEL_ENV: "preview" };
    expect(keyringStatus(preview)).toMatchObject({ available: false, problem: "refused on preview deployments" });
    expect(reason(() => decryptSecret(old, ctxA, preview))).toBe("unavailable");
    expect(reason(() => encryptSecret(SECRET, ctxA, {}))).toBe("unavailable");
  });
});

describe("BL-STAB-7b — a company's SAM.gov key: shape and save outcomes", () => {
  it("accepts a trimmed key of the right shape and never echoes a bad one", () => {
    expect(validateSamKeyInput(`  ${SECRET}  `)).toEqual({ ok: true, key: SECRET });
    for (const bad of ["short", `${SECRET.slice(0, 20)} ${SECRET.slice(20)}`, "x".repeat(129), `${SECRET}!`, 42, null]) {
      const r = validateSamKeyInput(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toContain(String(bad).slice(0, 8));
    }
  });

  it("saves only a key SAM.gov recognised, and says so", () => {
    expect(saveOutcome({ ok: true })).toEqual({ save: true, status: "ok", verified: true });
    expect(saveOutcome({ ok: false, cls: "rate_limited" })).toEqual({ save: true, status: "rate_limited", verified: false });
    expect(saveOutcome({ ok: false, cls: "bad_request" })).toEqual({ save: true, status: "ok", verified: false });
    for (const cls of ["key_invalid", "key_forbidden", "timeout", "network", "upstream", "bad_response", "not_found"] as const) {
      expect(saveOutcome({ ok: false, cls })).toEqual({ save: false, cls });
    }
    expect(savedMessage("ok", "wxyz")).toBe("Saved. SAM.gov accepted the key (••••wxyz); FORGE uses it for your company from now on.");
    expect(refusedMessage("key_invalid", "abcd")).toBe(
      "SAM.gov rejected this key: it is invalid, expired or not yet active. Nothing was saved. Your current key (••••abcd) is still in use.",
    );
    expect(refusedMessage("timeout", null)).toBe("SAM.gov couldn't be reached to test the key, so nothing was saved. Try again in a few minutes.");
  });
});
