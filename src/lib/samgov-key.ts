import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationSamgovKeys, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { testSamKey } from "@/lib/samgov";
import { samErrorMessage, type SamAudience, type SamFailure, type SamKeySource } from "@/lib/samgov-errors";
import {
  DATABASE_PENDING_MESSAGE,
  KEYRING_UNAVAILABLE_MESSAGE,
  SAM_KEY_TEST_LIMITS,
  refusedMessage,
  saveOutcome,
  savedMessage,
  tooManyTestsMessage,
  validateSamKeyInput,
} from "@/lib/samgov-key-logic";
import { safeQuery } from "@/lib/schema-resilience";
import { SecretBoxError, canDecryptKeyId, decryptSecret, encryptSecret, keyringStatus } from "@/lib/secret-box";

/**
 * BL-STAB-7a/7b — the SAM.gov key a call uses, as a value that can't leak
 * by accident: the key sits in a private field and its JSON, string and
 * console forms show only the last four characters. Company work resolves
 * one with `resolveSamCredential(organizationId)` (the company's own key,
 * else FORGE's shared one); platform work (the gold set) uses
 * `platformSamCredential({ audience: "operator" })`.
 */
export class SamCredential {
  readonly #key: string;
  readonly source: SamKeySource;
  readonly audience: SamAudience;
  readonly organizationId: string | null;
  readonly last4: string;

  constructor(key: string, opts: { source: SamKeySource; audience: SamAudience; organizationId: string | null }) {
    this.#key = key;
    this.source = opts.source;
    this.audience = opts.audience;
    this.organizationId = opts.organizationId;
    this.last4 = key.slice(-4);
  }

  /** The key itself, for samgov.ts to put on a request to a SAM.gov host. */
  revealForSamRequest(): string {
    return this.#key;
  }

  toJSON() {
    return { source: this.source, last4: `••••${this.last4}` };
  }

  toString(): string {
    return `SamCredential(${this.source} ••••${this.last4})`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/** FORGE's shared key (SAMGOV_API_KEY), or null when it is not set. */
export function platformSamCredential(
  opts: { audience?: SamAudience; organizationId?: string | null } = {},
  env: Record<string, string | undefined> = process.env,
): SamCredential | null {
  const key = (env.SAMGOV_API_KEY ?? "").trim();
  if (!key) return null;
  return new SamCredential(key, { source: "platform", audience: opts.audience ?? "tenant", organizationId: opts.organizationId ?? null });
}

export type SamKeyResolution = { ok: true; cred: SamCredential } | { ok: false; failure: SamFailure };

const PURPOSE = "samgov_api_key" as const;

/** The company's stored key row, or null (no row, or the table isn't there yet). */
async function storedKey(organizationId: string): Promise<{ ciphertext: string; keyId: string; last4: string } | null> {
  const rows = await safeQuery(
    () =>
      db
        .select({ ciphertext: organizationSamgovKeys.ciphertext, keyId: organizationSamgovKeys.keyId, last4: organizationSamgovKeys.last4 })
        .from(organizationSamgovKeys)
        .where(eq(organizationSamgovKeys.organizationId, organizationId))
        .limit(1),
    [],
    { tag: "samgov-key.resolve" },
  );
  return rows[0] ?? null;
}

/**
 * The key a company's SAM.gov work uses: its own when one is saved and
 * readable here, else FORGE's shared key, else none. A company key that
 * can't be read here (keyring missing or rotated away, or a row copied
 * from another company) falls back to the shared key; a key SAM.gov
 * rejects does not (the company sees its own key's error).
 */
export async function resolveSamCredential(organizationId: string): Promise<SamKeyResolution> {
  let unreadable = false;
  let row: Awaited<ReturnType<typeof storedKey>> = null;
  try {
    row = await storedKey(organizationId);
  } catch (err) {
    log.warn("[samgov-key]", "company key lookup failed; using the shared key", { organizationId, error: err });
  }
  if (row) {
    try {
      const key = decryptSecret(row.ciphertext, { purpose: PURPOSE, organizationId });
      return { ok: true, cred: new SamCredential(key, { source: "company", audience: "tenant", organizationId }) };
    } catch (err) {
      unreadable = true;
      const reason = err instanceof SecretBoxError ? err.reason : "unknown";
      // A kid that is in the ring but fails to decrypt means the ring changed under the same id.
      if (reason === "auth_failed" && canDecryptKeyId(row.keyId)) {
        log.error("[samgov-key]", "company key failed to decrypt", { organizationId, keyId: row.keyId, error: new Error(`SAM.gov key for an organization failed to decrypt under key id ${row.keyId}`) });
      } else {
        log.warn("[samgov-key]", "company key unreadable here; using the shared key", { organizationId, reason });
      }
    }
  }
  const shared = platformSamCredential({ organizationId });
  if (shared) return { ok: true, cred: shared };
  const cls = unreadable ? "key_unreadable" : "missing_key";
  return { ok: false, failure: { ok: false, cls, error: samErrorMessage({ cls, source: "company", audience: "tenant" }) } };
}

export type SamKeyStatusView = {
  /** Which key SAM.gov work uses for this company now. */
  inUse: "company" | "platform" | "none";
  usable: boolean;
  platformConfigured: boolean;
  /** Keys can be saved on this server (the keyring is available and the table exists). */
  canSave: boolean;
  /** The table exists (migration 0127 applied). */
  dbReady: boolean;
  company: null | {
    last4: string;
    status: string;
    statusAt: Date;
    verifiedAt: Date | null;
    setAt: Date;
    setByName: string | null;
    /** The key's id is in this server's keyring (checked without decrypting). */
    readable: boolean;
  };
};

/** Where a company's SAM.gov key stands, for pages: never decrypts. */
export async function getSamKeyStatus(organizationId: string): Promise<SamKeyStatusView> {
  const query = () =>
    db
      .select({
        keyId: organizationSamgovKeys.keyId,
        last4: organizationSamgovKeys.last4,
        status: organizationSamgovKeys.status,
        statusAt: organizationSamgovKeys.statusAt,
        verifiedAt: organizationSamgovKeys.verifiedAt,
        setAt: organizationSamgovKeys.setAt,
        setByName: users.name,
      })
      .from(organizationSamgovKeys)
      .leftJoin(users, eq(users.id, organizationSamgovKeys.setByUserId))
      .where(eq(organizationSamgovKeys.organizationId, organizationId))
      .limit(1);
  // null: the table isn't there yet (code deployed ahead of migration 0127).
  const rows = await safeQuery<Awaited<ReturnType<typeof query>> | null>(query, null, { tag: "samgov-key.status" });
  const dbReady = rows !== null;
  const row = rows?.[0];
  const platformConfigured = platformSamCredential() !== null;
  const company = row ? { ...row, readable: canDecryptKeyId(row.keyId) } : null;
  const inUse = company?.readable ? "company" : platformConfigured ? "platform" : "none";
  return { inUse, usable: inUse !== "none", platformConfigured, canSave: dbReady && keyringStatus().available, dbReady, company };
}

type Actor = { userId: string; email?: string | null };

/**
 * Save a company's SAM.gov key, but only once SAM.gov has recognised it
 * in one test search. The key is stored encrypted and bound to the
 * company; the audit carries its last four characters only.
 */
export async function setCompanySamKey(input: {
  organizationId: string;
  rawKey: unknown;
  actor: Actor;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { organizationId, actor } = input;
  const valid = validateSamKeyInput(input.rawKey);
  if (!valid.ok) return valid;
  if (!keyringStatus().available) return { ok: false, error: KEYRING_UNAVAILABLE_MESSAGE };
  const status = await getSamKeyStatus(organizationId);
  if (!status.dbReady) return { ok: false, error: DATABASE_PENDING_MESSAGE };

  const perUser = await enforceRateLimit({ key: `samgov-key-test:user:${actor.userId}`, limit: SAM_KEY_TEST_LIMITS.perUserPerHour, windowSeconds: 3600 });
  if (!perUser.ok) return { ok: false, error: tooManyTestsMessage("user", perUser.retryAfter) };
  const perOrg = await enforceRateLimit({ key: `samgov-key-test:org:${organizationId}`, limit: SAM_KEY_TEST_LIMITS.perOrgPerHour, windowSeconds: 3600 });
  if (!perOrg.ok) return { ok: false, error: tooManyTestsMessage("company", perOrg.retryAfter) };

  const candidate = new SamCredential(valid.key, { source: "company", audience: "tenant", organizationId });
  const outcome = saveOutcome(await testSamKey(candidate));
  const previousLast4 = status.company?.last4 ?? null;
  if (!outcome.save) {
    await recordAudit({
      organizationId,
      actor,
      action: "settings.samgov_key.test_failed",
      resourceType: "organization",
      resourceId: organizationId,
      metadata: { last4: candidate.last4, result: outcome.cls },
    });
    return { ok: false, error: refusedMessage(outcome.cls, previousLast4) };
  }

  const { ciphertext, keyId } = encryptSecret(valid.key, { purpose: PURPOSE, organizationId });
  const now = new Date();
  const values = {
    ciphertext,
    keyId,
    last4: candidate.last4,
    status: outcome.status,
    statusAt: now,
    verifiedAt: outcome.verified ? now : null,
    setByUserId: actor.userId,
    setAt: now,
    updatedAt: now,
  };
  try {
    await db
      .insert(organizationSamgovKeys)
      .values({ organizationId, ...values })
      .onConflictDoUpdate({ target: organizationSamgovKeys.organizationId, set: values });
  } catch (err) {
    log.error("[samgov-key]", "saving the company key failed", { organizationId, error: err });
    return { ok: false, error: DATABASE_PENDING_MESSAGE };
  }
  await recordAudit({
    organizationId,
    actor,
    action: "settings.samgov_key.set",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { last4: candidate.last4, previousLast4, status: outcome.status },
  });
  return { ok: true, message: savedMessage(outcome.status, candidate.last4) };
}

/** Remove a company's own key (no keyring needed); SAM.gov work falls back to the shared key. */
export async function removeCompanySamKey(input: { organizationId: string; actor: Actor }): Promise<{ ok: true; removed: boolean }> {
  const { organizationId, actor } = input;
  const [row] = await db
    .delete(organizationSamgovKeys)
    .where(eq(organizationSamgovKeys.organizationId, organizationId))
    .returning({ last4: organizationSamgovKeys.last4 });
  if (row) {
    await recordAudit({
      organizationId,
      actor,
      action: "settings.samgov_key.remove",
      resourceType: "organization",
      resourceId: organizationId,
      metadata: { last4: row.last4 },
    });
  }
  return { ok: true, removed: Boolean(row) };
}
