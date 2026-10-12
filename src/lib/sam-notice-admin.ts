import "server-only";
import { and, count, desc, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { samNoticeLoadRuns, samNotices } from "@/db/schema";
import { getPlatformSetting } from "@/lib/platform-settings";
import { compareDescriptions, type SpotCheckResult } from "@/lib/sam-notice-csv";
import { noticeDescriptionUrl, readNoticeDescriptions } from "@/lib/samgov";
import { platformSamCredential } from "@/lib/samgov-key";
import { safeQuery } from "@/lib/schema-resilience";

/**
 * BL-STAB-10b — what platform admins see of FORGE's copy of SAM.gov's
 * notice descriptions (`/admin/sam-notices`): the load's runs, the rows by
 * state, freshness, the switches, and a spot-check of a few rows against
 * SAM.gov itself on the shared key. Read-only; platform data only.
 */
export async function samNoticeOverview() {
  const [runs, states, totals, size, load, reads] = await Promise.all([
    safeQuery(() => db.select().from(samNoticeLoadRuns).orderBy(desc(samNoticeLoadRuns.startedAt)).limit(14), [], { tag: "sam-notice.runs" }),
    safeQuery(() => db.select({ state: samNotices.state, n: count() }).from(samNotices).groupBy(samNotices.state), [], { tag: "sam-notice.states" }),
    safeQuery(
      () => db.select({ gone: sql<number>`count(*) filter (where ${samNotices.goneOn} is not null)::int`, newest: max(samNotices.postedAt) }).from(samNotices),
      [],
      { tag: "sam-notice.totals" },
    ),
    safeQuery(async () => Number(((await db.execute(sql`select pg_total_relation_size('sam_notice') as bytes`)) as unknown as { rows: { bytes: string }[] }).rows[0]?.bytes ?? 0), 0, { tag: "sam-notice.size" }),
    getPlatformSetting("sam_notice.load", "on"),
    getPlatformSetting("sam_notice.reads", "on"),
  ]);
  const lastGood = runs.find((r) => r.status === "ok" || r.status === "unchanged") ?? null;
  return {
    runs,
    byState: Object.fromEntries(states.map((s) => [s.state, s.n])) as Record<string, number>,
    gone: totals[0]?.gone ?? 0,
    newestPostedAt: totals[0]?.newest ?? null,
    bytes: size,
    fileUpdatedAt: lastGood?.sourceModifiedAt ?? null,
    switches: { load: load !== "off", reads: reads !== "off" },
  };
}

const SAMPLE = { text: 6, truncated: 2, none: 5 } as const;

/**
 * Read a few stored rows' descriptions live from SAM.gov (one shared-key
 * request each, 13 at most) and count how they compare. Counts only:
 * no text or ids leave this function.
 */
export async function spotCheckSamNotices(): Promise<{ ok: true; sampled: number; counts: Record<SpotCheckResult, number> } | { ok: false; error: string }> {
  const cred = platformSamCredential({ audience: "operator" });
  if (!cred) return { ok: false, error: "SAMGOV_API_KEY isn't set, so SAM.gov can't be asked." };
  const recent = sql`${samNotices.postedAt} > now() - interval '30 days'`;
  const pick = (state: keyof typeof SAMPLE) =>
    db
      .select({ noticeId: samNotices.noticeId, state: samNotices.state, description: samNotices.description })
      .from(samNotices)
      .where(and(eq(samNotices.state, state), isNull(samNotices.goneOn), recent))
      .orderBy(sql`random()`)
      .limit(SAMPLE[state]);
  const rows = (await Promise.all([pick("text"), pick("truncated"), pick("none")])).flat();
  if (rows.length === 0) return { ok: false, error: "The copy has no notices posted in the last 30 days to check yet." };
  const live = await readNoticeDescriptions(cred, rows.map((r) => ({ noticeId: r.noticeId, description: noticeDescriptionUrl(r.noticeId) ?? "" })), rows.length);
  const counts: Record<SpotCheckResult, number> = { same: 0, different: 0, missing_in_file: 0, not_at_sam: 0, unread: 0 };
  for (const r of rows) counts[compareDescriptions(r, live.get(r.noticeId) ?? { unread: true })]++;
  return { ok: true, sampled: rows.length, counts };
}
