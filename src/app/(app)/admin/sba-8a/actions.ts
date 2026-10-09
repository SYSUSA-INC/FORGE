"use server";

import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { certImportRuns, certFirms } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import {
  getCertRetentionMonths,
  setCertRetentionMonths,
} from "@/lib/platform-settings";
import { fetchSba8aPage, runCertRefresh, upsertParticipant, type CronRefreshResult } from "@/lib/cert-refresh";
import {
  CERT_SPECS,
  certSpecFor,
  normalizeCsvRow,
  type NormalizeTrace,
} from "@/lib/sba-8a";
import { samErrorMessage } from "@/lib/samgov-errors";
import { platformSamCredential } from "@/lib/samgov-key";
import { log } from "@/lib/log";

// BL-STAB-7c — the cron refresh lives in src/lib/cert-refresh.ts: an
// exported function in this "use server" module is a callable action.
export type { CronRefreshResult };

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
  // The registry is platform data: always FORGE's shared key, operator wording.
  const cred = platformSamCredential({ audience: "operator" });
  if (!cred) return { ok: false, error: samErrorMessage({ cls: "missing_key", source: "platform", audience: "operator" }) };
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
      const res = await fetchSba8aPage(cred, page, certType);
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

/** Super-admin "Trigger refresh now" (the cron route calls runCertRefresh itself). */
export async function runCertRefreshAction(): Promise<CronRefreshResult> {
  await requireSuperadmin();
  const result = await runCertRefresh();
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
