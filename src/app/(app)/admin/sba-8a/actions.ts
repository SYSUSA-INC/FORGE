"use server";

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { certImportRuns, certFirms } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import {
  getCertRetentionMonths,
  setCertRetentionMonths,
} from "@/lib/platform-settings";
import {
  CERT_SPECS,
  certSpecFor,
  fetchSba8aPage,
  normalizeCsvRow,
  type NormalizeTrace,
  type Sba8aRow,
} from "@/lib/sba-8a";
import { log } from "@/lib/log";

/**
 * Pull a batch of pages from SAM.gov into `sba_8a_participant`.
 *
 * Serverless timeouts cap how much we can do per click — instead of
 * a long-running cron we let the operator click "Pull next batch"
 * until they reach the end. Each call pulls up to `pages` pages
 * sequentially, upserting rows by UEI.
 */
export async function pullSba8aFromSamAction(params: {
  startPage: number;
  pages: number;
  certType?: string;
}): Promise<
  | {
      ok: true;
      certType: string;
      pagesPulled: number;
      rowsSeen: number;
      rowsUpserted: number;
      nextPage: number | null;
      totalRecords: number;
      /** Populated only when no rows came back — surfaces the raw SAM
       *  response so the operator can diagnose tier limits / shape
       *  changes without server-log access. */
      debugSample: string | null;
      debugTopLevelKeys: string[] | null;
      debugNormalizeTrace: NormalizeTrace[] | null;
    }
  | { ok: false; error: string }
> {
  await requireSuperadmin();
  const apiKey = (process.env.SAMGOV_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "SAMGOV_API_KEY is not set. Provision a free SAM.gov API key and add it to the environment.",
    };
  }
  const certType = (params.certType || "8a").trim().toLowerCase();
  const spec = certSpecFor(certType);
  if (!spec) {
    return { ok: false, error: `Unknown cert type '${certType}'.` };
  }
  const startPage = Math.max(1, Math.floor(params.startPage || 1));
  // Server-side clamp. 50 pages × 10 records ≈ 500 firms per click,
  // ~15-25 sec under typical SAM.gov latency — comfortably under the
  // Vercel serverless 60s timeout while making real progress on the
  // ~10K-firm registry.
  const pages = Math.min(50, Math.max(1, Math.floor(params.pages || 25)));

  const [runRow] = await db
    .insert(certImportRuns)
    .values({ source: "sam.gov", certType, status: "running" })
    .returning({ id: certImportRuns.id });
  const runId = runRow.id;

  let rowsSeen = 0;
  let rowsUpserted = 0;
  let totalRecords = 0;
  let nextPage: number | null = null;
  let pagesActuallyPulled = 0;
  let lastDebugSample: string | null = null;
  let lastDebugKeys: string[] | null = null;
  let lastDebugTrace: NormalizeTrace[] | null = null;

  try {
    for (let i = 0; i < pages; i++) {
      const page = startPage + i;
      const res = await fetchSba8aPage(apiKey, page, certType);
      if (!res.ok) {
        throw new Error(res.error);
      }
      pagesActuallyPulled += 1;
      totalRecords = res.totalRecords;
      rowsSeen += res.rows.length;
      for (const r of res.rows) {
        await upsertParticipant(r);
        rowsUpserted += 1;
      }
      // Empty page = either past the end of the dataset OR a tier-
      // limited empty response. Capture the raw sample so we can tell
      // them apart from the UI.
      if (res.rows.length === 0) {
        lastDebugSample = res.debugRawSample;
        lastDebugKeys = res.debugTopLevelKeys;
        lastDebugTrace = res.debugNormalizeTrace;
        nextPage = null;
        break;
      }
      // Stop after the last numbered page in the dataset. Both `page`
      // and `totalPages` are 1-based.
      const totalPages = Math.max(
        1,
        Math.ceil(totalRecords / Math.max(1, res.rows.length)),
      );
      if (page >= totalPages) {
        nextPage = null;
        break;
      }
      nextPage = page + 1;
    }
    await db
      .update(certImportRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        rowsSeen,
        rowsUpserted,
      })
      .where(eq(certImportRuns.id, runId));
    revalidatePath("/admin/sba-8a");
    revalidatePath("/intelligence/firms");
    return {
      ok: true,
      certType,
      pagesPulled: pagesActuallyPulled,
      rowsSeen,
      rowsUpserted,
      nextPage,
      totalRecords,
      debugSample: rowsUpserted === 0 ? lastDebugSample : null,
      debugTopLevelKeys: rowsUpserted === 0 ? lastDebugKeys : null,
      debugNormalizeTrace: rowsUpserted === 0 ? lastDebugTrace : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[sba-8a-import]", "SAM.gov pull failed", { error: message });
    await db
      .update(certImportRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        rowsSeen,
        rowsUpserted,
        error: message.slice(0, 1000),
      })
      .where(eq(certImportRuns.id, runId));
    return { ok: false, error: message };
  }
}

export async function importSba8aCsvAction(
  csv: string,
): Promise<
  | { ok: true; rowsSeen: number; rowsUpserted: number; skipped: number }
  | { ok: false; error: string }
> {
  await requireSuperadmin();
  if (!csv.trim()) return { ok: false, error: "Paste CSV content to import." };

  const [runRow] = await db
    .insert(certImportRuns)
    .values({ source: "manual_csv", status: "running" })
    .returning({ id: certImportRuns.id });
  const runId = runRow.id;

  let rowsSeen = 0;
  let rowsUpserted = 0;
  let skipped = 0;
  try {
    const parsed = parseCsv(csv);
    rowsSeen = parsed.length;
    for (const obj of parsed) {
      const row = normalizeCsvRow(obj);
      if (!row) {
        skipped += 1;
        continue;
      }
      await upsertParticipant(row);
      rowsUpserted += 1;
    }
    await db
      .update(certImportRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        rowsSeen,
        rowsUpserted,
      })
      .where(eq(certImportRuns.id, runId));
    revalidatePath("/admin/sba-8a");
    revalidatePath("/intelligence/firms");
    return { ok: true, rowsSeen, rowsUpserted, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[sba-8a-import]", "CSV import failed", { error: message });
    await db
      .update(certImportRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        rowsSeen,
        rowsUpserted,
        error: message.slice(0, 1000),
      })
      .where(eq(certImportRuns.id, runId));
    return { ok: false, error: message };
  }
}

export type ImportRunSummary = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  certType: string;
  source: string;
  rowsSeen: number;
  rowsUpserted: number;
  error: string;
};

export async function listRecentImportRuns(): Promise<ImportRunSummary[]> {
  await requireSuperadmin();
  const rows = await db
    .select()
    .from(certImportRuns)
    .orderBy(desc(certImportRuns.startedAt))
    .limit(10);
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    status: r.status,
    certType: r.certType,
    source: r.source,
    rowsSeen: r.rowsSeen,
    rowsUpserted: r.rowsUpserted,
    error: r.error,
  }));
}

export type ParticipantStats = {
  /** Aggregate across all cert types. */
  total: number;
  active: number;
  graduated: number;
  terminated: number;
  /** Per-cert-type breakdown — one entry per CERT_SPEC. */
  byCertType: {
    certType: string;
    label: string;
    total: number;
    active: number;
    graduated: number;
    terminated: number;
  }[];
};

export async function getParticipantStats(): Promise<ParticipantStats> {
  await requireSuperadmin();
  const rows = await db
    .select({
      certType: certFirms.certType,
      total: sql<number>`count(*)::int`,
      active: sql<number>`sum(case when status='active' then 1 else 0 end)::int`,
      graduated: sql<number>`sum(case when status='graduated' then 1 else 0 end)::int`,
      terminated: sql<number>`sum(case when status='terminated' then 1 else 0 end)::int`,
    })
    .from(certFirms)
    .groupBy(certFirms.certType);

  const byType = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byType.set(r.certType, r);

  const byCertType = CERT_SPECS.map((spec) => {
    const r = byType.get(spec.certType);
    return {
      certType: spec.certType,
      label: spec.label,
      total: r?.total ?? 0,
      active: r?.active ?? 0,
      graduated: r?.graduated ?? 0,
      terminated: r?.terminated ?? 0,
    };
  });

  const total = byCertType.reduce((s, r) => s + r.total, 0);
  const active = byCertType.reduce((s, r) => s + r.active, 0);
  const graduated = byCertType.reduce((s, r) => s + r.graduated, 0);
  const terminated = byCertType.reduce((s, r) => s + r.terminated, 0);

  return { total, active, graduated, terminated, byCertType };
}

// ── helpers ──────────────────────────────────────────────────────────

async function upsertParticipant(row: Sba8aRow): Promise<void> {
  await db
    .insert(certFirms)
    .values({
      uei: row.uei,
      certType: row.certType,
      firmName: row.firmName,
      firmNameNorm: row.firmNameNorm,
      certEntryDate: row.certEntryDate,
      certExitDate: row.certExitDate,
      status: row.status,
      naicsPrimary: row.naicsPrimary,
      city: row.city,
      state: row.state,
      source: row.source,
      sourceUpdatedAt: row.sourceUpdatedAt,
    })
    // Composite unique on (uei, cert_type) — a firm with multiple
    // certs gets one row per cert, each kept fresh independently.
    .onConflictDoUpdate({
      target: [certFirms.uei, certFirms.certType],
      set: {
        firmName: row.firmName,
        firmNameNorm: row.firmNameNorm,
        certEntryDate: row.certEntryDate,
        certExitDate: row.certExitDate,
        status: row.status,
        naicsPrimary: row.naicsPrimary,
        city: row.city,
        state: row.state,
        source: row.source,
        sourceUpdatedAt: row.sourceUpdatedAt,
      },
    });
}

/**
 * Tiny RFC-4180-ish CSV parser. Splits on commas, honors double-quoted
 * fields with embedded commas/newlines, ignores blank lines. Trims the
 * header row only — data cells preserve internal whitespace.
 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      cur.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      cur.push(cell);
      cell = "";
      if (cur.some((c) => c.length > 0)) rows.push(cur);
      cur = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell);
    if (cur.some((c) => c.length > 0)) rows.push(cur);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      out[headers[i]] = cells[i] ?? "";
    }
    return out;
  });
}

// ── cron job + retention ────────────────────────────────────────────

/**
 * Pages per cert type pulled by the monthly cron. At 10 records per
 * page × 30 pages = 300 firms per cert type × 7 cert types = ~2100
 * records refreshed per run. Sits well under the SAM.gov free-tier
 * 1000 calls/day quota (210 calls) and under Vercel's 60s function
 * timeout (~45-60 sec total wall time).
 *
 * The cron isn't trying to be a full re-import — it catches recent
 * additions and updates for firms that already exist. Full backfills
 * stay an operator-initiated activity via the per-cert Pull batch UI.
 */
const CRON_PAGES_PER_CERT = 30;

export type CronRefreshResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pulled: Array<{
    certType: string;
    rowsUpserted: number;
    error: string | null;
  }>;
  cleanup: {
    retentionMonths: number;
    rowsDeleted: number;
  };
  totalRowsUpserted: number;
};

/**
 * Refreshes the cert-firm registry from SAM.gov for every cert type
 * with a verified business-type code, then prunes graduated firms
 * whose cert_exit_date is older than the configured retention window.
 *
 * Intended caller: the /api/cron/refresh-certifications route via
 * Vercel Cron. Also exposed as a "Trigger refresh now" admin button
 * for on-demand runs.
 *
 * Caller must be super-admin OR be coming from the cron route (which
 * checks CRON_SECRET). This function itself does NOT check auth —
 * keep that gate in the caller so we don't bypass it from inside the
 * server-action env.
 */
async function runCertRefreshInternal(): Promise<CronRefreshResult> {
  const start = new Date();
  const apiKey = (process.env.SAMGOV_API_KEY || "").trim();
  const retentionMonths = await getCertRetentionMonths();
  const pulled: CronRefreshResult["pulled"] = [];
  let totalRowsUpserted = 0;

  if (!apiKey) {
    for (const spec of CERT_SPECS) {
      if (!spec.verified) continue;
      pulled.push({
        certType: spec.certType,
        rowsUpserted: 0,
        error: "SAMGOV_API_KEY not set",
      });
    }
  } else {
    // Pull each verified cert type sequentially. Unverified codes get
    // skipped — re-running with wrong codes would burn the SAM quota
    // for zero return.
    for (const spec of CERT_SPECS) {
      if (!spec.verified) continue;
      let rowsUpserted = 0;
      let error: string | null = null;
      const [runRow] = await db
        .insert(certImportRuns)
        .values({ source: "cron.sam.gov", certType: spec.certType, status: "running" })
        .returning({ id: certImportRuns.id });
      try {
        for (let page = 1; page <= CRON_PAGES_PER_CERT; page++) {
          const res = await fetchSba8aPage(apiKey, page, spec.certType);
          if (!res.ok) {
            error = res.error;
            break;
          }
          if (res.rows.length === 0) break;
          for (const row of res.rows) {
            await upsertParticipant(row);
            rowsUpserted += 1;
          }
        }
        await db
          .update(certImportRuns)
          .set({
            status: error ? "failed" : "ok",
            finishedAt: new Date(),
            rowsUpserted,
            error: (error ?? "").slice(0, 1000),
          })
          .where(eq(certImportRuns.id, runRow.id));
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        log.error("[cert-cron]", "pull failed", {
          certType: spec.certType,
          error,
        });
        await db
          .update(certImportRuns)
          .set({
            status: "failed",
            finishedAt: new Date(),
            rowsUpserted,
            error: error.slice(0, 1000),
          })
          .where(eq(certImportRuns.id, runRow.id));
      }
      pulled.push({ certType: spec.certType, rowsUpserted, error });
      totalRowsUpserted += rowsUpserted;
    }
  }

  // Auto-prune stale graduates. Hard delete is reversible by re-
  // pulling from SAM if the firm is still in the registry — and once
  // a firm graduated > retention months ago, BD intent is they're no
  // longer a chip-worthy capture target anyway.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  const deleted = await db
    .delete(certFirms)
    .where(
      and(
        eq(certFirms.status, "graduated"),
        lt(certFirms.certExitDate, cutoff),
      ),
    )
    .returning({ id: certFirms.id });

  const finish = new Date();
  log.info("[cert-cron]", "refresh done", {
    durationMs: finish.getTime() - start.getTime(),
    totalRowsUpserted,
    rowsDeleted: deleted.length,
    retentionMonths,
  });

  return {
    ok: true,
    startedAt: start.toISOString(),
    finishedAt: finish.toISOString(),
    durationMs: finish.getTime() - start.getTime(),
    pulled,
    cleanup: { retentionMonths, rowsDeleted: deleted.length },
    totalRowsUpserted,
  };
}

/** Public super-admin wrapper for manual "Trigger refresh now" button. */
export async function runCertRefreshAction(): Promise<CronRefreshResult> {
  await requireSuperadmin();
  const result = await runCertRefreshInternal();
  revalidatePath("/admin/sba-8a");
  revalidatePath("/intelligence/firms");
  return result;
}

/**
 * Same operation but exposed for the /api/cron route. The route is
 * responsible for verifying CRON_SECRET before calling this — that
 * gate plus this function being package-internal (not exported as a
 * server action) keeps the surface tight.
 */
export async function runCertRefreshFromCron(): Promise<CronRefreshResult> {
  const result = await runCertRefreshInternal();
  revalidatePath("/admin/sba-8a");
  revalidatePath("/intelligence/firms");
  return result;
}

// ── retention setting ──────────────────────────────────────────────

export async function getCertRetentionMonthsAction(): Promise<number> {
  await requireSuperadmin();
  return getCertRetentionMonths();
}

export async function setCertRetentionMonthsAction(
  months: number,
): Promise<{ ok: true; months: number } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const clamped = Math.min(240, Math.max(1, Math.floor(months)));
  if (!Number.isFinite(clamped) || clamped < 1) {
    return { ok: false, error: "Retention months must be a positive integer." };
  }
  try {
    await setCertRetentionMonths(clamped, actor.id);
    revalidatePath("/admin/sba-8a");
    return { ok: true, months: clamped };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
