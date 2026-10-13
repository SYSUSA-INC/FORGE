import "server-only";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { samNoticeLoadRuns, samNotices } from "@/db/schema";
import { log } from "@/lib/log";
import { getPlatformSetting } from "@/lib/platform-settings";
import { escapeHtml, type DescriptionState } from "@/lib/samgov-match";

/**
 * BL-STAB-10b — searches read FORGE's copy of SAM.gov's notice
 * descriptions (filled nightly by `sam-notice-load.ts`) before spending a
 * SAM.gov request on one. Read-only, SELECTs by notice id: nothing about
 * who searched what is written or logged. Any failure — the table missing,
 * the database slow or down, the `sam_notice.reads` switch off — reads as
 * "not in the copy", so searches fall back to reading SAM.gov live.
 */

/**
 * `text` is HTML-escaped, the shape of SAM.gov's live descriptions, so a
 * literal "<" in the file's plain text is never taken for a tag. Cut at
 * SAM.gov's 32,000 characters is `partial`: a hit counts, a miss proves
 * nothing. `link`: in the file, but only as a link to SAM.gov.
 */
export type StoredDescription = { text: string; partial: boolean } | { none: true } | { link: true };

/** A stored description as matching reads it (matchStored); a link-only row is a miss. */
export function asDescription(s: StoredDescription | undefined): DescriptionState | null {
  if (!s || "link" in s) return null;
  if ("none" in s) return { none: true };
  return s.partial ? { text: s.text, partial: true } : { text: s.text };
}

export type NoticeStore = {
  on: boolean;
  /** When SAM.gov last updated the file the copy was loaded from. */
  fileOf: Date | null;
  /** The newest notice in that file: anything posted after it can't be in the copy. */
  newestPostedAt: Date | null;
  lookup(noticeIds: string[]): Promise<Map<string, StoredDescription>>;
};

const LOOKUP_MS = 5_000;
const CHUNK = 1_000;
const OFF: NoticeStore = { on: false, fileOf: null, newestPostedAt: null, lookup: async () => new Map() };

/** Resolves to `fallback` after `ms` (the search stops waiting; `onTimeout` lets the work stop too). */
function within<T>(p: Promise<T>, ms: number, fallback: T, onTimeout = () => {}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(fallback);
    }, ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Never the error itself: drizzle's message lists the query's parameters, here notice ids. */
function failure(err: unknown) {
  const cause = (err as { cause?: unknown })?.cause ?? err;
  return { code: (cause as { code?: string })?.code ?? null, reason: cause instanceof Error ? cause.message.slice(0, 200) : "unknown" };
}

async function lookup(noticeIds: string[]): Promise<Map<string, StoredDescription>> {
  const ids = [...new Set(noticeIds.map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{32}$/.test(id)))];
  const out = new Map<string, StoredDescription>();
  if (ids.length === 0) return out;
  let abandoned = false;
  const read = async () => {
    for (let i = 0; i < ids.length && !abandoned; i += CHUNK) {
      const rows = await db
        .select({ noticeId: samNotices.noticeId, state: samNotices.state, description: samNotices.description })
        .from(samNotices)
        .where(inArray(samNotices.noticeId, ids.slice(i, i + CHUNK)));
      for (const r of rows) {
        if (r.state === "none") out.set(r.noticeId, { none: true });
        else if ((r.state === "text" || r.state === "truncated") && r.description) out.set(r.noticeId, { text: escapeHtml(r.description), partial: r.state === "truncated" });
        else out.set(r.noticeId, { link: true });
      }
    }
    return true;
  };
  const done = await within(
    read().catch((err) => {
      log.warn("[sam-store]", "lookup failed", { asked: ids.length, ...failure(err) });
      return false;
    }),
    LOOKUP_MS,
    false,
    () => {
      abandoned = true;
      log.warn("[sam-store]", "lookup timed out", { asked: ids.length });
    },
  );
  if (!done) return new Map();
  let partial = 0;
  for (const d of out.values()) if ("text" in d && d.partial) partial++;
  log.info("[sam-store]", "lookup", { asked: ids.length, hits: out.size, misses: ids.length - out.size, partial });
  return out;
}

/** The copy as searches see it now: off (switched off, never loaded, or unreachable) reads nothing. */
export async function noticeStore(): Promise<NoticeStore> {
  try {
    const last = await within(
      (async () => {
        if ((await getPlatformSetting("sam_notice.reads", "on")) === "off") return null;
        const [run] = await db
          .select({ fileOf: samNoticeLoadRuns.sourceModifiedAt, newestPostedAt: samNoticeLoadRuns.newestPostedAt })
          .from(samNoticeLoadRuns)
          .where(inArray(samNoticeLoadRuns.status, ["ok", "unchanged"]))
          .orderBy(desc(samNoticeLoadRuns.startedAt))
          .limit(1);
        return run ?? null;
      })(),
      LOOKUP_MS,
      null,
    );
    if (!last) return OFF;
    return { on: true, fileOf: last.fileOf, newestPostedAt: last.newestPostedAt, lookup };
  } catch (err) {
    log.warn("[sam-store]", "status failed", failure(err));
    return OFF;
  }
}
