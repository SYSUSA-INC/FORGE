import "server-only";
import { and, eq, lt, max } from "drizzle-orm";
import { db } from "@/db";
import { certFirms, certImportRuns } from "@/db/schema";
import { log } from "@/lib/log";
import { getCertRetentionMonths } from "@/lib/platform-settings";
import { CERT_SPECS, parseSba8aPage, sba8aPageUrl, type Sba8aFetchResult, type Sba8aRow } from "@/lib/sba-8a";
import { samGetText } from "@/lib/samgov";
import { SAM_TIMEOUTS_MS, isKeyOrQuotaFailure, samErrorMessage, type SamErrorClass } from "@/lib/samgov-errors";
import { platformSamCredential, type SamCredential } from "@/lib/samgov-key";

/**
 * BL-STAB-7c — the certification-firm registry from SAM.gov, on FORGE's
 * shared key (the registry is platform data: no company's key is ever
 * used). Server-only, so the key never reaches the client components
 * that import src/lib/sba-8a.ts, and the cron entry point is a plain
 * function the cron route calls after checking CRON_SECRET (it used to
 * be exported from a "use server" module, which made it callable as a
 * server action).
 */

/** One page of a cert type from SAM.gov (1-based page). */
export async function fetchSba8aPage(cred: SamCredential, page: number, certType: string = "8a"): Promise<Sba8aFetchResult> {
  const url = sba8aPageUrl(page, certType);
  if (!url) return { ok: false, error: `Unknown cert type '${certType}'.` };
  const r = await samGetText(cred, url, "sba8a");
  if (!r.ok) return { ok: false, error: r.error, cls: r.cls };
  return parseSba8aPage(r.text, certType);
}

export async function upsertParticipant(row: Sba8aRow): Promise<void> {
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
 * Pages per cert type pulled by the monthly cron: 30 pages × 10 records
 * = 300 firms per cert type. It catches recent additions and updates;
 * full backfills stay an operator action (Pull batch on /admin/sba-8a).
 */
const CRON_PAGES_PER_CERT = 30;
/**
 * Stop starting new pages after this: the slowest allowed page (its SAM.gov
 * deadline), its upserts, the run-row update and the prune must still end
 * inside the route's 60 s limit.
 */
const RUN_BUDGET_MS = 60_000 - SAM_TIMEOUTS_MS.sba8a - 5_000;

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

/** A failure that would repeat for every later cert type (the key, the quota, or SAM.gov itself). */
function stopsRun(cls: SamErrorClass | undefined): boolean {
  return isKeyOrQuotaFailure(cls) || cls === "timeout" || cls === "network" || cls === "upstream";
}

/**
 * Refresh the cert-firm registry for every verified cert type, then
 * prune graduates past the retention window. The caller is responsible
 * for authorization (super-admin action, or the cron route's
 * CRON_SECRET). After a key, quota or SAM.gov-down failure — or once the
 * time budget is used — the remaining cert types are not pulled, and
 * say why. Each run starts with the cert type whose last complete pull is
 * oldest, so a type the budget cut off goes first next time.
 */
export async function runCertRefresh(): Promise<CronRefreshResult> {
  const start = new Date();
  const deadline = start.getTime() + RUN_BUDGET_MS;
  const cred = platformSamCredential({ audience: "operator" });
  const retentionMonths = await getCertRetentionMonths();
  const pulled: CronRefreshResult["pulled"] = [];
  let totalRowsUpserted = 0;
  let stoppedBy: string | null = cred ? null : samErrorMessage({ cls: "missing_key", source: "platform", audience: "operator" });

  // Unverified codes are skipped: pulling them would burn the SAM quota for nothing.
  const lastComplete = new Map(
    (
      await db
        .select({ certType: certImportRuns.certType, at: max(certImportRuns.startedAt) })
        .from(certImportRuns)
        .where(and(eq(certImportRuns.source, "cron.sam.gov"), eq(certImportRuns.status, "ok")))
        .groupBy(certImportRuns.certType)
    ).map((r) => [r.certType, r.at?.getTime() ?? 0]),
  );
  const specs = CERT_SPECS.filter((s) => s.verified).sort((a, b) => (lastComplete.get(a.certType) ?? 0) - (lastComplete.get(b.certType) ?? 0));
  for (const spec of specs) {
    if (stoppedBy || !cred) {
      pulled.push({ certType: spec.certType, rowsUpserted: 0, error: cred ? `Not pulled: SAM.gov stopped this run earlier — ${stoppedBy}` : stoppedBy });
      continue;
    }
    if (Date.now() >= deadline) {
      pulled.push({ certType: spec.certType, rowsUpserted: 0, error: "Not pulled: this run's time budget was used up; the next run starts with this cert type." });
      continue;
    }
    let rowsUpserted = 0;
    let error: string | null = null;
    let note: string | null = null;
    const [runRow] = await db
      .insert(certImportRuns)
      .values({ source: "cron.sam.gov", certType: spec.certType, status: "running" })
      .returning({ id: certImportRuns.id });
    try {
      let page = 1;
      let exhausted = false;
      for (; page <= CRON_PAGES_PER_CERT && Date.now() < deadline; page++) {
        const res = await fetchSba8aPage(cred, page, spec.certType);
        if (!res.ok) {
          error = res.error;
          if (stopsRun(res.cls)) stoppedBy = res.error;
          break;
        }
        if (res.rows.length === 0) {
          exhausted = true;
          break;
        }
        for (const row of res.rows) {
          await upsertParticipant(row);
          rowsUpserted += 1;
        }
      }
      // Cut short by the budget: say so, and keep it first in line next run.
      if (!error && !exhausted && page <= CRON_PAGES_PER_CERT) {
        note = `Stopped after page ${page - 1} of ${CRON_PAGES_PER_CERT}: this run's time budget was used up.`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      log.error("[cert-cron]", "pull failed", { certType: spec.certType, error: err });
    }
    await db
      .update(certImportRuns)
      .set({ status: error ? "failed" : note ? "partial" : "ok", finishedAt: new Date(), rowsUpserted, error: (error ?? note ?? "").slice(0, 1000) })
      .where(eq(certImportRuns.id, runRow!.id));
    pulled.push({ certType: spec.certType, rowsUpserted, error: error ?? note });
    totalRowsUpserted += rowsUpserted;
  }

  // Auto-prune stale graduates. Hard delete is reversible by re-pulling
  // from SAM if the firm is still in the registry — and once a firm
  // graduated > retention months ago, it is no longer a capture target.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  const deleted = await db
    .delete(certFirms)
    .where(and(eq(certFirms.status, "graduated"), lt(certFirms.certExitDate, cutoff)))
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
