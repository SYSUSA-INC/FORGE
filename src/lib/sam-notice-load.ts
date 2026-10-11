import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { samNoticeLoadRuns, samNotices } from "@/db/schema";
import { log } from "@/lib/log";
import { getPlatformSetting } from "@/lib/platform-settings";
import { csvParser, decodeCp1252, readHeader, toNotice, type SamFileHeader, type SamFileNotice } from "@/lib/sam-notice-csv";

/**
 * BL-STAB-10b — FORGE's copy of SAM.gov's public notice descriptions.
 * SAM.gov publishes every active notice, with its full description, as one
 * public CSV each night (no API key, so no request limit is spent). This
 * is the only writer of `sam_notice`; it runs from the CRON_SECRET-gated
 * route. No transactions: each batch stands alone and a later run repeats
 * it harmlessly, so a run cut short is finished by the next one.
 */
export const SAM_NOTICE_FILE = "https://falextracts.s3.amazonaws.com/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv";

const BATCH = 500;
const MAX_BYTES = 1_000_000_000;
/** Stop starting batches here; the route allows 300 s. */
const STOP_AT_MS = 250_000;
const MIN_ROWS = 30_000;
const GONE_PURGE_DAYS = 30;
const RUN_KEEP_DAYS = 180;

export type SamNoticeLoadStatus = "ok" | "unchanged" | "partial" | "rejected" | "failed" | "paused" | "busy";
export type SamNoticeLoadResult = { status: SamNoticeLoadStatus; rowsSeen: number; rowsWritten: number; rowsGone: number; rowsPurged: number; rowsSkipped: number; error: string };

const digestOf = (n: SamFileNotice) => createHash("md5").update(`${n.state}\n${n.description ?? ""}`).digest("hex");

export async function runSamNoticeLoad(opts: { minRows?: number } = {}): Promise<SamNoticeLoadResult> {
  const started = Date.now();
  const result: SamNoticeLoadResult = { status: "failed", rowsSeen: 0, rowsWritten: 0, rowsGone: 0, rowsPurged: 0, rowsSkipped: 0, error: "" };
  if ((await getPlatformSetting("sam_notice.load", "on")) === "off") return { ...result, status: "paused" };
  // Another tick still running (started under 6 minutes ago): leave it.
  const [running] = await db
    .select({ id: samNoticeLoadRuns.id })
    .from(samNoticeLoadRuns)
    .where(and(eq(samNoticeLoadRuns.status, "running"), sql`${samNoticeLoadRuns.startedAt} > now() - interval '6 minutes'`))
    .limit(1);
  if (running) return { ...result, status: "busy" };

  const [last] = await db
    .select({ etag: samNoticeLoadRuns.etag, sourceModifiedAt: samNoticeLoadRuns.sourceModifiedAt })
    .from(samNoticeLoadRuns)
    .where(inArray(samNoticeLoadRuns.status, ["ok", "unchanged"]))
    .orderBy(desc(samNoticeLoadRuns.startedAt))
    .limit(1);
  const [run] = await db.insert(samNoticeLoadRuns).values({}).returning({ id: samNoticeLoadRuns.id });
  const finish = async (status: SamNoticeLoadStatus, extra: Partial<typeof samNoticeLoadRuns.$inferInsert> = {}) => {
    result.status = status;
    await db
      .update(samNoticeLoadRuns)
      .set({ status, finishedAt: new Date(), rowsSeen: result.rowsSeen, rowsWritten: result.rowsWritten, rowsGone: result.rowsGone, rowsPurged: result.rowsPurged, rowsSkipped: result.rowsSkipped, error: result.error.slice(0, 1000), ...extra })
      .where(eq(samNoticeLoadRuns.id, run!.id));
    return result;
  };

  let res: Response;
  try {
    // A fixed public URL with no key: plain fetch, never samGet.
    res = await fetch(SAM_NOTICE_FILE, {
      headers: last?.etag ? { "if-none-match": last.etag } : {},
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(280_000),
    });
  } catch (err) {
    result.error = `SAM.gov's notice file couldn't be downloaded: ${err instanceof Error ? err.name : "error"}`;
    log.error("[sam-notices]", "download failed", { error: new Error(result.error) });
    return finish("failed");
  }
  if (res.status === 304) return finish("unchanged", { etag: last?.etag ?? "", sourceModifiedAt: last?.sourceModifiedAt ?? null });
  if (!res.ok || !res.body) {
    result.error = `SAM.gov's notice file answered HTTP ${res.status}`;
    log.error("[sam-notices]", "download refused", { error: new Error(result.error) });
    return finish("failed");
  }
  const length = Number(res.headers.get("content-length") ?? NaN);
  if (length > MAX_BYTES) {
    result.error = `SAM.gov's notice file is ${length} bytes, over the ${MAX_BYTES} cap`;
    await res.body.cancel().catch(() => undefined);
    return finish("rejected");
  }
  const modified = res.headers.get("last-modified");
  const sourceModifiedAt = modified && !Number.isNaN(Date.parse(modified)) ? new Date(modified) : null;
  if (sourceModifiedAt && started - sourceModifiedAt.getTime() > 48 * 3_600_000) {
    log.error("[sam-notices]", "file is stale", { error: new Error(`SAM.gov's notice file was last updated ${sourceModifiedAt.toISOString()}`) });
  }

  // What is stored now, to write only what changed.
  const stored = new Map((await db.select({ id: samNotices.noticeId, digest: samNotices.digest, goneOn: samNotices.goneOn }).from(samNotices)).map((r) => [r.id, r]));
  const seen = new Set<string>();
  let header: SamFileHeader | null = null;
  let headerProblem = "";
  let badWidth = 0;
  let newest: Date | null = null;
  let pending: string[][] = [];
  let queue: (SamFileNotice & { digest: string })[] = [];
  const parser = csvParser((fields) => pending.push(fields));

  const flush = async () => {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    await db
      .insert(samNotices)
      .values(batch.map((n) => ({ noticeId: n.noticeId, description: n.description, state: n.state, postedAt: n.postedAt, digest: n.digest, goneOn: null })))
      .onConflictDoUpdate({
        target: samNotices.noticeId,
        set: { description: sql`excluded.description`, state: sql`excluded.state`, postedAt: sql`excluded.posted_at`, digest: sql`excluded.digest`, goneOn: null },
        setWhere: sql`${samNotices.digest} IS DISTINCT FROM excluded.digest OR ${samNotices.goneOn} IS NOT NULL`,
      });
    result.rowsWritten += batch.length;
  };
  const take = (fields: string[]) => {
    if (!header) {
      const h = readHeader(fields);
      if (h.ok) header = h.header;
      else headerProblem = `SAM.gov's notice file is missing the column(s) ${h.missing.join(", ")}`;
      return;
    }
    if (fields.length !== header.width) {
      badWidth++;
      return;
    }
    const n = toNotice(fields, header);
    if (!n || !n.active) {
      result.rowsSkipped++;
      return;
    }
    result.rowsSeen++;
    seen.add(n.noticeId);
    if (n.postedAt && (!newest || n.postedAt > newest)) newest = n.postedAt;
    const digest = digestOf(n);
    const was = stored.get(n.noticeId);
    if (was && was.digest === digest && !was.goneOn) return;
    queue.push({ ...n, digest });
  };

  let bytes = 0;
  let cut = false;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      parser.push(decodeCp1252(value));
      for (const fields of pending) take(fields);
      pending = [];
      if (headerProblem) break;
      if (queue.length >= BATCH) await flush();
      if (Date.now() - started > STOP_AT_MS) {
        cut = true;
        break;
      }
    }
  } catch (err) {
    cut = true;
    log.warn("[sam-notices]", "download stopped", { error: err });
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const { inQuote } = parser.end();
  for (const fields of pending) take(fields);
  if (headerProblem) {
    result.error = headerProblem;
    log.error("[sam-notices]", "file rejected", { error: new Error(headerProblem) });
    return finish("rejected", { bytes });
  }
  await flush();

  // Mark what left the file only on a whole, well-formed file: a cut one would mark half the store gone.
  const whole = !cut && (Number.isNaN(length) || bytes === length) && !inQuote && badWidth <= result.rowsSeen / 100 && result.rowsSeen >= (opts.minRows ?? MIN_ROWS);
  if (!whole) {
    result.error = cut ? "Stopped before the end of the file; the next run finishes it." : `The file looked incomplete (${result.rowsSeen} rows, ${badWidth} malformed${inQuote ? ", ended inside a quote" : ""}).`;
    return finish("partial", { bytes, newestPostedAt: newest });
  }
  const goneIds = [...stored.entries()].filter(([id, r]) => !r.goneOn && !seen.has(id)).map(([id]) => id);
  for (let i = 0; i < goneIds.length; i += 5000) {
    await db.update(samNotices).set({ goneOn: sql`current_date` }).where(and(inArray(samNotices.noticeId, goneIds.slice(i, i + 5000)), isNull(samNotices.goneOn)));
  }
  result.rowsGone = goneIds.length;
  const purged = await db
    .delete(samNotices)
    .where(sql`${samNotices.goneOn} < current_date - ${GONE_PURGE_DAYS}::int`)
    .returning({ id: samNotices.noticeId });
  result.rowsPurged = purged.length;
  await db.delete(samNoticeLoadRuns).where(lt(samNoticeLoadRuns.startedAt, new Date(started - RUN_KEEP_DAYS * 86_400_000)));
  return finish("ok", { etag: res.headers.get("etag") ?? "", sourceModifiedAt, bytes, newestPostedAt: newest });
}
