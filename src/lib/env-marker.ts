import { sql } from "drizzle-orm";
import { db } from "@/db";
import { log } from "@/lib/log";

/**
 * BL-ENV-SEP — environment marker verification.
 *
 * Reads `_forge_env.expected_env` on every cold start and compares it
 * to the runtime's `VERCEL_ENV` (or `FORGE_ENV_OVERRIDE` if the
 * operator explicitly set one). On mismatch, throws — the caller in
 * instrumentation.ts converts that into a hard `process.exit(1)` so
 * the misconfigured deploy doesn't serve a single request against the
 * wrong DB.
 *
 * First-boot semantics: if the marker row doesn't exist yet, insert
 * one with the current environment. Subsequent boots verify.
 *
 * Why we crash rather than warn: a staging deploy pointed at the prod
 * DB will write proposal sections, audit log rows, and AI usage
 * counters into customer data within seconds of serving traffic.
 * Failing closed is the only safe posture.
 *
 * To re-label an environment (rare — usually during a cutover from
 * one Vercel project to another), update the marker directly:
 *   UPDATE _forge_env SET expected_env = 'staging' WHERE id = 1;
 * Or use the admin UI affordance (separate PR).
 */

export type EnvMarkerResult =
  | { kind: "ok"; expected: string; current: string }
  | { kind: "first-boot"; recorded: string }
  | { kind: "mismatch"; expected: string; current: string }
  | { kind: "skipped"; reason: string };

/**
 * Returns the runtime environment label. `FORGE_ENV_OVERRIDE` takes
 * precedence (lets operators explicitly tag a non-Vercel runtime
 * like a local dev machine connected to staging for debugging).
 * Otherwise falls back to `VERCEL_ENV`.
 *
 * Returns null on unknown / unset — the caller treats that as a skip.
 */
function currentEnvLabel(): string | null {
  const override = (process.env.FORGE_ENV_OVERRIDE || "").trim().toLowerCase();
  if (override) return override;
  const vercel = (process.env.VERCEL_ENV || "").trim().toLowerCase();
  if (vercel === "production" || vercel === "preview" || vercel === "development") {
    return vercel;
  }
  return null;
}

export async function verifyEnvMarker(): Promise<EnvMarkerResult> {
  const current = currentEnvLabel();
  if (!current) {
    return {
      kind: "skipped",
      reason:
        "Neither FORGE_ENV_OVERRIDE nor a recognized VERCEL_ENV is set; running on a local / unfamiliar runtime — skipping marker check.",
    };
  }

  // Read the marker. If the table doesn't exist yet (very fresh DB
  // before migrations ran), tolerate it — the migration runner will
  // create the table on its next pass.
  let existing: { expected_env: string } | undefined;
  try {
    const rows = await db.execute<{ expected_env: string }>(
      sql`SELECT expected_env FROM "_forge_env" WHERE id = 1 LIMIT 1`,
    );
    existing = (rows.rows as { expected_env: string }[])[0];
  } catch (err) {
    log.warn("[env-marker]", "could not read marker — table likely not yet migrated", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      kind: "skipped",
      reason: "marker table not yet present (fresh deploy?); will check next boot",
    };
  }

  if (!existing) {
    // First boot: record the marker.
    try {
      await db.execute(
        sql`INSERT INTO "_forge_env" (id, expected_env)
            VALUES (1, ${current})
            ON CONFLICT (id) DO NOTHING`,
      );
    } catch (err) {
      log.warn("[env-marker]", "could not write first-boot marker", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        kind: "skipped",
        reason: "marker write failed",
      };
    }
    return { kind: "first-boot", recorded: current };
  }

  if (existing.expected_env !== current) {
    return {
      kind: "mismatch",
      expected: existing.expected_env,
      current,
    };
  }

  // Touch last_verified_at so operators can confirm the marker is
  // being checked on every boot.
  try {
    await db.execute(
      sql`UPDATE "_forge_env" SET last_verified_at = now() WHERE id = 1`,
    );
  } catch {
    // Non-fatal — the marker check itself succeeded.
  }

  return { kind: "ok", expected: existing.expected_env, current };
}
