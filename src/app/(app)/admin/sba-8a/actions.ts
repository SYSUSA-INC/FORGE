"use server";

import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { certImportRuns, certFirms } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import {
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
}): Promise<
  | {
      ok: true;
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
  const startPage = Math.max(1, Math.floor(params.startPage || 1));
  // Server-side clamp. 50 pages × 10 records ≈ 500 firms per click,
  // ~15-25 sec under typical SAM.gov latency — comfortably under the
  // Vercel serverless 60s timeout while making real progress on the
  // ~10K-firm registry.
  const pages = Math.min(50, Math.max(1, Math.floor(params.pages || 25)));

  const [runRow] = await db
    .insert(certImportRuns)
    .values({ source: "sam.gov", status: "running" })
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
      const res = await fetchSba8aPage(apiKey, page);
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
    source: r.source,
    rowsSeen: r.rowsSeen,
    rowsUpserted: r.rowsUpserted,
    error: r.error,
  }));
}

export async function getParticipantStats(): Promise<{
  total: number;
  active: number;
  graduated: number;
  terminated: number;
}> {
  await requireSuperadmin();
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`sum(case when status='active' then 1 else 0 end)::int`,
      graduated: sql<number>`sum(case when status='graduated' then 1 else 0 end)::int`,
      terminated: sql<number>`sum(case when status='terminated' then 1 else 0 end)::int`,
    })
    .from(certFirms);
  return {
    total: stats?.total ?? 0,
    active: stats?.active ?? 0,
    graduated: stats?.graduated ?? 0,
    terminated: stats?.terminated ?? 0,
  };
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
