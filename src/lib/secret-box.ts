import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { resolveEnvLabel } from "@/lib/env-label";

/**
 * BL-STAB-7b — secrets a company gives FORGE (its SAM.gov API key), kept
 * at rest as AES-256-GCM ciphertext.
 *
 * - Keyring: FORGE_SECRET_KEYS = "kid:base64(32 bytes)[,kid:…]". The first
 *   entry encrypts; every entry decrypts, so a new key is added in front
 *   and an old one kept until nothing uses it. A malformed ring is
 *   refused as a whole, and the ring is always refused on preview
 *   deployments (their databases are copies of production).
 * - Each value is bound (AAD) to its purpose, organization and key id, so
 *   a row copied to another company, or reused for another purpose, does
 *   not decrypt.
 * - Stored form: "fsb1.<kid>.<iv>.<tag>.<ciphertext>" (base64url), a
 *   fresh 12-byte IV each time and a 16-byte tag checked before use.
 * - Errors carry only a reason, never key material. Nothing is logged.
 */
export type SecretPurpose = "samgov_api_key";
export type SecretBoxReason = "unavailable" | "unknown_key" | "malformed" | "auth_failed";

export class SecretBoxError extends Error {
  constructor(readonly reason: SecretBoxReason) {
    super(`secret-box: ${reason}`);
    this.name = "SecretBoxError";
  }
}

type Env = Record<string, string | undefined>;
type Ring = { available: true; primary: string; keys: Map<string, Buffer> } | { available: false; problem: string };

const PREFIX = "fsb1";
const KID = /^[a-z0-9]{2,16}$/;
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

function parseRing(env: Env): Ring {
  if (resolveEnvLabel(env) === "preview") return { available: false, problem: "refused on preview deployments" };
  const raw = (env.FORGE_SECRET_KEYS ?? "").trim();
  if (!raw) return { available: false, problem: "FORGE_SECRET_KEYS is not set" };
  const keys = new Map<string, Buffer>();
  let primary = "";
  for (const [i, entry] of raw.split(",").entries()) {
    const at = entry.indexOf(":");
    const kid = at > 0 ? entry.slice(0, at).trim() : "";
    const value = at > 0 ? entry.slice(at + 1).trim() : "";
    if (!KID.test(kid)) return { available: false, problem: `entry ${i + 1}: the key id must be 2–16 lowercase letters or digits` };
    if (!BASE64_32.test(value)) return { available: false, problem: `entry ${i + 1} (${kid}): the key must be 32 bytes in base64` };
    if (keys.has(kid)) return { available: false, problem: `key id ${kid} appears twice` };
    keys.set(kid, Buffer.from(value, "base64"));
    if (!primary) primary = kid;
  }
  return { available: true, primary, keys };
}

let cached: { raw: string; label: string | null; ring: Ring } | null = null;
function ringOf(env: Env): Ring {
  const raw = env.FORGE_SECRET_KEYS ?? "";
  const label = resolveEnvLabel(env);
  if (cached && cached.raw === raw && cached.label === label) return cached.ring;
  const ring = parseRing(env);
  cached = { raw, label, ring };
  return ring;
}

/** Whether secrets can be saved and read here; key ids only, never key bytes. */
export function keyringStatus(env: Env = process.env): { available: boolean; primaryKeyId: string | null; keyIds: string[]; problem: string | null } {
  const ring = ringOf(env);
  return ring.available
    ? { available: true, primaryKeyId: ring.primary, keyIds: [...ring.keys.keys()], problem: null }
    : { available: false, primaryKeyId: null, keyIds: [], problem: ring.problem };
}

/** Whether a stored value's key id is in the ring (a status read: no decryption). */
export function canDecryptKeyId(keyId: string, env: Env = process.env): boolean {
  const ring = ringOf(env);
  return ring.available && ring.keys.has(keyId);
}

function aad(purpose: SecretPurpose, organizationId: string, kid: string): Buffer {
  return Buffer.from(`${PREFIX}|${purpose}|${organizationId}|${kid}`, "utf8");
}

export function encryptSecret(
  plaintext: string,
  ctx: { purpose: SecretPurpose; organizationId: string },
  env: Env = process.env,
): { ciphertext: string; keyId: string } {
  const ring = ringOf(env);
  if (!ring.available) throw new SecretBoxError("unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.keys.get(ring.primary)!, iv, { authTagLength: 16 });
  cipher.setAAD(aad(ctx.purpose, ctx.organizationId, ring.primary));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [PREFIX, ring.primary, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")];
  return { ciphertext: parts.join("."), keyId: ring.primary };
}

export function decryptSecret(ciphertext: string, ctx: { purpose: SecretPurpose; organizationId: string }, env: Env = process.env): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 5 || parts[0] !== PREFIX) throw new SecretBoxError("malformed");
  const [, kid, ivPart, tagPart, bodyPart] = parts as [string, string, string, string, string];
  const ring = ringOf(env);
  if (!ring.available) throw new SecretBoxError("unavailable");
  const key = ring.keys.get(kid);
  if (!key) throw new SecretBoxError("unknown_key");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new SecretBoxError("malformed");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad(ctx.purpose, ctx.organizationId, kid));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("auth_failed");
  }
}
