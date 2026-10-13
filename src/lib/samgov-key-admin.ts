import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationSamgovKeys, organizations, users } from "@/db/schema";
import { log } from "@/lib/log";
import { SecretBoxError, canDecryptKeyId, decryptSecret, encryptSecret, keyringStatus } from "@/lib/secret-box";

/**
 * BL-STAB-7e — what platform admins see of companies' own SAM.gov keys
 * (`/admin/samgov-keys`): never the key — the last four characters, what
 * SAM.gov last said about it, who set it, and which entry of
 * FORGE_SECRET_KEYS holds it — and the re-encryption that moves every key
 * to the keyring's first entry after a rotation, so the old entry can be
 * retired. Cross-company by design; callers gate with requireSuperadmin.
 */

const PURPOSE = "samgov_api_key" as const;

export type CompanyKeyRow = {
  organizationId: string;
  organizationName: string;
  last4: string;
  status: string;
  statusAt: Date;
  verifiedAt: Date | null;
  setAt: Date;
  setBy: string | null;
  keyId: string;
  /** It decrypts here, so FORGE can use it. */
  readable: boolean;
  /**
   * Why not, when it doesn't: its keyring entry is missing; the entry is
   * there but its value doesn't match (a mistyped FORGE_SECRET_KEYS — every
   * key under it fails the same way); or the stored value is damaged.
   */
  decrypts: "ok" | "missing_entry" | "wrong_entry" | "damaged";
  /** Encrypted under the keyring's first entry (nothing to re-encrypt). */
  current: boolean;
};

export async function listCompanySamKeys(): Promise<{ keyring: ReturnType<typeof keyringStatus>; rows: CompanyKeyRow[] }> {
  const keyring = keyringStatus();
  const rows = await db
    .select({
      organizationId: organizationSamgovKeys.organizationId,
      organizationName: organizations.name,
      last4: organizationSamgovKeys.last4,
      status: organizationSamgovKeys.status,
      statusAt: organizationSamgovKeys.statusAt,
      verifiedAt: organizationSamgovKeys.verifiedAt,
      setAt: organizationSamgovKeys.setAt,
      setByName: users.name,
      setByEmail: users.email,
      keyId: organizationSamgovKeys.keyId,
      ciphertext: organizationSamgovKeys.ciphertext,
    })
    .from(organizationSamgovKeys)
    .innerJoin(organizations, eq(organizations.id, organizationSamgovKeys.organizationId))
    .leftJoin(users, eq(users.id, organizationSamgovKeys.setByUserId))
    .orderBy(asc(organizations.name));
  return {
    keyring,
    // Only whether each decrypts leaves this function, never the ciphertext or the key.
    rows: rows.map(({ setByName, setByEmail, ciphertext, ...r }) => {
      const decrypts = decryptState(ciphertext, r.keyId, r.organizationId);
      return { ...r, setBy: setByName || setByEmail || null, readable: decrypts === "ok", decrypts, current: r.keyId === keyring.primaryKeyId };
    }),
  };
}

/** A trial decryption (the result is discarded): whether FORGE can use the stored key. */
function decryptState(ciphertext: string, keyId: string, organizationId: string): CompanyKeyRow["decrypts"] {
  if (!canDecryptKeyId(keyId)) return "missing_entry";
  try {
    decryptSecret(ciphertext, { purpose: PURPOSE, organizationId });
    return "ok";
  } catch (err) {
    return err instanceof SecretBoxError && err.reason === "auth_failed" ? "wrong_entry" : "damaged";
  }
}

/**
 * `mismatched`: keys whose entry is there but doesn't decrypt them, per key
 * id — almost always a mistyped FORGE_SECRET_KEYS value (restore it), not
 * damaged keys; `failed`: anything else (a damaged value, a database error).
 */
export type ReencryptResult =
  | { ok: true; moved: number; alreadyCurrent: number; unreadable: number; mismatched: { keyId: string; count: number }[]; failed: number }
  | { ok: false; error: string };

/**
 * Re-encrypt every company key not under the keyring's first entry. A key
 * whose entry is missing here is counted, not touched; one that fails to
 * decrypt is logged (organization and key id only). Each row is written
 * only if it still holds what was read, so a key saved meanwhile wins.
 */
export async function reencryptCompanySamKeys(): Promise<ReencryptResult> {
  const keyring = keyringStatus();
  if (!keyring.available || !keyring.primaryKeyId) {
    return { ok: false, error: `Keys can't be re-encrypted here: ${keyring.problem ?? "FORGE_SECRET_KEYS is not available"}.` };
  }
  const rows = await db
    .select({ organizationId: organizationSamgovKeys.organizationId, ciphertext: organizationSamgovKeys.ciphertext, keyId: organizationSamgovKeys.keyId })
    .from(organizationSamgovKeys);
  const result = { ok: true as const, moved: 0, alreadyCurrent: 0, unreadable: 0, mismatched: [] as { keyId: string; count: number }[], failed: 0 };
  const mismatch = new Map<string, number>();
  for (const row of rows) {
    if (row.keyId === keyring.primaryKeyId) {
      result.alreadyCurrent++;
      continue;
    }
    if (!canDecryptKeyId(row.keyId)) {
      result.unreadable++;
      continue;
    }
    try {
      const ctx = { purpose: PURPOSE, organizationId: row.organizationId };
      const next = encryptSecret(decryptSecret(row.ciphertext, ctx), ctx);
      const written = await db
        .update(organizationSamgovKeys)
        .set({ ciphertext: next.ciphertext, keyId: next.keyId, updatedAt: new Date() })
        .where(
          and(
            eq(organizationSamgovKeys.organizationId, row.organizationId),
            eq(organizationSamgovKeys.keyId, row.keyId),
            eq(organizationSamgovKeys.ciphertext, row.ciphertext),
          ),
        )
        .returning({ organizationId: organizationSamgovKeys.organizationId });
      if (written.length > 0) result.moved++;
    } catch (err) {
      const reason = err instanceof SecretBoxError ? err.reason : "error";
      if (reason === "auth_failed") mismatch.set(row.keyId, (mismatch.get(row.keyId) ?? 0) + 1);
      else result.failed++;
      log.error("[samgov-key]", "company key re-encryption failed", {
        organizationId: row.organizationId,
        keyId: row.keyId,
        error: new Error(`A company's SAM.gov key couldn't be re-encrypted from key id ${row.keyId} (${reason})`),
      });
    }
  }
  result.mismatched = [...mismatch].map(([keyId, count]) => ({ keyId, count }));
  return result;
}
