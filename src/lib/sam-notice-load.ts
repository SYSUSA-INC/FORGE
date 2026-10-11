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
    .select({ etag: samNoticeLoadRuns.etag, sourceModifiedAt: samNoticeLoadRuns.sourceModifiedAt, newestPostedAt: samNoticeLoadRuns.newestPostedAt })
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
  const fail = (status: "failed" | "rejected" | "partial", message: string, extra: Partial<typeof samNoticeLoadRuns.$inferInsert> = {}) => {
    result.error = message;
    log.error("[sam-notices]", message, { error: new Error(message) });
    return finish(status, extra);
  };
  // GSA's export can stop refreshing while every tick still gets a 304: check the file's age either way.
  const staleCheck = (modifiedAt: Date | null) => {
    if (modifiedAt && started - modifiedAt.getTime() > 48 * 3_600_000) {
      log.error("[sam-notices]", "file is stale", { error: new Error(`SAM.gov's notice file was last updated ${modifiedAt.toISOString()}`) });
    }
  };

  // Every failure after this point is recorded on the run, not left "running".
  try {
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
      return fail("failed", `SAM.gov's notice file couldn't be downloaded: ${err instanceof Error ? err.name : "error"}`);
    }
    if (res.status === 304) {
      staleCheck(last?.sourceModifiedAt ?? null);
      return finish("unchanged", { etag: last?.etag ?? "", sourceModifiedAt: last?.sourceModifiedAt ?? null, newestPostedAt: last?.newestPostedAt ?? null });
    }
    if (!res.ok || !res.body) return fail("failed", `SAM.gov's notice file answered HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? NaN);
    if (length > MAX_BYTES) {
      await res.body.cancel().catch(() => undefined);
      return fail("rejected", `SAM.gov's notice file is ${length} bytes, over the ${MAX_BYTES} cap`);
    }
    const modified = res.headers.get("last-modified");
    const sourceModifiedAt = modified && !Number.isNaN(Date.parse(modified)) ? new Date(modified) : null;
    staleCheck(sourceModifiedAt);

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
      // One row per notice in a statement (Postgres refuses to update a row twice in one).
      const batch = [...new Map(queue.map((n) => [n.noticeId, n])).values()];
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
      if (headerProblem) return;
      if (!header) {
        const h = readHeader(fields);
        if (h.ok) header = h.header;
        else headerProblem = `SAM.gov's notice file is missing the column(s) ${h.missing.join(", ")}`;
        return;
      }
      if (fields.length !== header.width) {
        badWidth++;
        // Not written, but still in the file: never marked gone for a malformed row.
        const id = (fields[header.at.noticeId] ?? "").trim().toLowerCase();
        if (/^[0-9a-f]{32}$/.test(id)) seen.add(id);
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
        // Only the download may stop early quietly; a database error fails the run (outer catch).
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          cut = true;
          log.warn("[sam-notices]", "download stopped", { error: err });
          break;
        }
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        parser.push(decodeCp1252(chunk.value));
        for (const fields of pending) take(fields);
        pending = [];
        if (headerProblem) break;
        if (queue.length >= BATCH) await flush();
        if (Date.now() - started > STOP_AT_MS) {
          cut = true;
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const { inQuote } = parser.end();
    // end() hands over the row in progress: only a body read to its last byte has a whole last row.
    const complete = !cut && (Number.isNaN(length) || bytes === length) && !inQuote;
    if (complete) for (const fields of pending) take(fields);
    if (headerProblem) return fail("rejected", headerProblem, { bytes });
    await flush();

    // Mark what left the file only on a whole, well-formed file: a cut one would mark half the store gone.
    const whole = complete && badWidth <= result.rowsSeen / 100 && result.rowsSeen >= (opts.minRows ?? MIN_ROWS);
    if (!whole) {
      if (cut) {
        result.error = "Stopped before the end of the file; the next run finishes it.";
        return finish("partial", { bytes, newestPostedAt: newest });
      }
      return fail("partial", `SAM.gov's notice file looked incomplete (${bytes} of ${Number.isNaN(length) ? "?" : length} bytes, ${result.rowsSeen} rows, ${badWidth} malformed${inQuote ? ", ended inside a quote" : ""}).`, { bytes, newestPostedAt: newest });
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
  } catch (err) {
    return fail("failed", `The SAM.gov notice load failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
  }
}
