import "server-only";
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizationSamgovKeys, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { testSamKey } from "@/lib/samgov";
import { samErrorMessage, type SamAudience, type SamEndpoint, type SamFailure, type SamKeySource } from "@/lib/samgov-errors";
import {
  DATABASE_PENDING_MESSAGE,
  KEYRING_UNAVAILABLE_MESSAGE,
  SAM_KEY_TEST_LIMITS,
  refusedMessage,
  saveFailedMessage,
  saveOutcome,
  savedMessage,
  tooManyTestsMessage,
  validateSamKeyInput,
} from "@/lib/samgov-key-logic";
import { isSchemaSyncError, safeQuery } from "@/lib/schema-resilience";
import { SecretBoxError, canDecryptKeyId, decryptSecret, encryptSecret, keyringStatus } from "@/lib/secret-box";

/**
 * BL-STAB-7a/7b — the SAM.gov key a call uses, as a value that can't leak
 * by accident: the key sits in a private field and its JSON, string and
 * console forms show only the last four characters. Company work resolves
 * one with `resolveSamCredential(organizationId)` (the company's own key,
 * else FORGE's shared one); platform work (the gold set) uses
 * `platformSamCredential({ audience: "operator" })`.
 */
/** BL-STAB-7d — what an answer from SAM.gov says about a company key. */
export type SamKeyOutcome = "ok" | "invalid" | "forbidden" | "rate_limited";
type OutcomeWriter = (outcome: SamKeyOutcome, endpoint: SamEndpoint) => Promise<void>;

export class SamCredential {
  readonly #key: string;
  readonly source: SamKeySource;
  readonly audience: SamAudience;
  readonly organizationId: string | null;
  readonly last4: string;
  /** For a company key: what SAM.gov last said about it ("ok", "invalid", "forbidden", "rate_limited"). */
  readonly storedStatus: string | null;
  readonly #onOutcome: OutcomeWriter | null;
  readonly #reported = new Set<SamKeyOutcome>();

  constructor(
    key: string,
    opts: { source: SamKeySource; audience: SamAudience; organizationId: string | null; storedStatus?: string | null; onOutcome?: OutcomeWriter },
  ) {
    this.#key = key;
    this.source = opts.source;
    this.audience = opts.audience;
    this.organizationId = opts.organizationId;
    this.last4 = key.slice(-4);
    this.storedStatus = opts.storedStatus ?? null;
    this.#onOutcome = opts.onOutcome ?? null;
  }

  /**
   * BL-STAB-7d — record what SAM.gov said about this key (company keys
   * only; once per kind of answer per credential). Never throws.
   */
  async reportOutcome(outcome: SamKeyOutcome, endpoint: SamEndpoint): Promise<void> {
    if (!this.#onOutcome || this.#reported.has(outcome)) return;
    this.#reported.add(outcome);
    try {
      await this.#onOutcome(outcome, endpoint);
    } catch (err) {
      log.warn("[samgov-key]", "recording the key's status failed", { organizationId: this.organizationId, outcome, error: err });
    }
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
async function storedKey(organizationId: string): Promise<{ ciphertext: string; keyId: string; last4: string; status: string } | null> {
  const rows = await safeQuery(
    () =>
      db
        .select({
          ciphertext: organizationSamgovKeys.ciphertext,
          keyId: organizationSamgovKeys.keyId,
          last4: organizationSamgovKeys.last4,
          status: organizationSamgovKeys.status,
        })
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
      const { ciphertext, status } = row;
      return {
        ok: true,
        cred: new SamCredential(key, {
          source: "company",
          audience: "tenant",
          organizationId,
          storedStatus: status,
          onOutcome: (outcome, endpoint) => recordKeyOutcome({ organizationId, ciphertext, storedStatus: status, outcome, endpoint }),
        }),
      };
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

/**
 * BL-STAB-7d — record what SAM.gov said about a company key. Every write
 * is guarded by the ciphertext the call used, so a call still running
 * with a key that has since been replaced never marks the new one. A
 * rejection or acceptance that changes the status is audited (system
 * actor; last four only); the daily request limit is status only, and a
 * working key refreshes its "accepted on" date at most hourly.
 */
async function recordKeyOutcome(i: { organizationId: string; ciphertext: string; storedStatus: string; outcome: SamKeyOutcome; endpoint: SamEndpoint }) {
  const k = organizationSamgovKeys;
  const sameKey = and(eq(k.organizationId, i.organizationId), eq(k.ciphertext, i.ciphertext));
  if (i.outcome === "ok" && i.storedStatus === "ok") {
    await db
      .update(k)
      .set({ verifiedAt: sql`now()` })
      .where(and(sameKey, or(isNull(k.verifiedAt), lt(k.verifiedAt, sql`now() - interval '1 hour'`))));
    return;
  }
  const changes = i.outcome === "ok" ? { status: "ok", statusAt: sql`now()`, verifiedAt: sql`now()` } : { status: i.outcome, statusAt: sql`now()` };
  const [row] = await db
    .update(k)
    .set(changes)
    .where(and(sameKey, ne(k.status, i.outcome)))
    .returning({ last4: k.last4 });
  if (!row) return;
  const audited = i.outcome === "ok" ? i.storedStatus === "invalid" || i.storedStatus === "forbidden" : i.outcome !== "rate_limited";
  if (!audited) return;
  await recordAudit({
    organizationId: i.organizationId,
    actor: { userId: null },
    action: i.outcome === "ok" ? "settings.samgov_key.accepted" : "settings.samgov_key.rejected",
    resourceType: "organization",
    resourceId: i.organizationId,
    metadata: { last4: row.last4, status: i.outcome, endpoint: i.endpoint },
  });
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
  // Only a key this server can read is "still in use" if the new one isn't saved.
  const keptLast4 = status.company?.readable ? status.company.last4 : null;
  if (!outcome.save) {
    await recordAudit({
      organizationId,
      actor,
      action: "settings.samgov_key.test_failed",
      resourceType: "organization",
      resourceId: organizationId,
      metadata: { last4: candidate.last4, result: outcome.cls },
    });
    return { ok: false, error: refusedMessage(outcome.cls, keptLast4) };
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
    return { ok: false, error: isSchemaSyncError(err) ? DATABASE_PENDING_MESSAGE : saveFailedMessage(keptLast4) };
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
