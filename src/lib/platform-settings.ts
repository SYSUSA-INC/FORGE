import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { safeQuery } from "@/lib/schema-resilience";

/**
 * Read a platform-wide setting by key. Returns the fallback when the
 * key is missing OR the underlying table doesn't exist yet (graceful
 * degradation when a deploy lands before the migration is applied).
 */
export async function getPlatformSetting(
  key: string,
  fallback: string,
): Promise<string> {
  return safeQuery<string>(
    async () => {
      const [row] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, key))
        .limit(1);
      return row?.value ?? fallback;
    },
    fallback,
    { tag: `getPlatformSetting:${key}` },
  );
}

/**
 * Write a platform-wide setting. Caller is responsible for any
 * authorisation gates (super-admin only, usually).
 */
export async function setPlatformSetting(
  key: string,
  value: string,
  updatedBy: string | null,
): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value,
        updatedBy,
        updatedAt: new Date(),
      },
    });
}

// ── typed convenience accessors for known settings ──────────────────

export const CERT_RETENTION_DEFAULT_MONTHS = 36;

/**
 * How old a graduated cert firm has to be before the monthly cron
 * job prunes it from the local registry. Configurable via
 * /admin/sba-8a. Stored as text in platform_setting; we parse + clamp
 * here so callers always get a sane integer.
 */
export async function getCertRetentionMonths(): Promise<number> {
  const raw = await getPlatformSetting(
    "cert_retention_months",
    String(CERT_RETENTION_DEFAULT_MONTHS),
  );
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return CERT_RETENTION_DEFAULT_MONTHS;
  return Math.min(240, Math.max(1, n));
}

export async function setCertRetentionMonths(
  months: number,
  updatedBy: string | null,
): Promise<void> {
  const clamped = Math.min(240, Math.max(1, Math.floor(months)));
  await setPlatformSetting("cert_retention_months", String(clamped), updatedBy);
}
