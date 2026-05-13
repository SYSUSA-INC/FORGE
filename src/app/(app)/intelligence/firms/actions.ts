"use server";

import { and, asc, desc, eq, gte, ilike, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { certFirms } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { safeQuery } from "@/lib/schema-resilience";

export type FirmsSearchCriteria = {
  /** 'all' | 'active' | 'graduated' | 'terminated' | 'unknown'. Defaults to 'all'. */
  status?: string;
  /** Cert type filter: '8a' | 'hubzone' | 'wosb' | ... | 'all' (default). */
  certType?: string;
  /** Prefix match against firms' primary NAICS (e.g. "541" → all 541xxx). */
  naicsPrefix?: string;
  /** Two-letter US state code. Empty = no state filter. */
  state?: string;
  /** Restricts to firms that left the program within the last N months. */
  graduatedSinceMonths?: number;
  /** Case-insensitive substring on firm name. */
  nameKeyword?: string;
  page?: number;
  limit?: number;
};

export type FirmRow = {
  uei: string;
  firmName: string;
  certType: string;
  status: string;
  certEntryDate: string | null;
  certExitDate: string | null;
  naicsPrimary: string;
  city: string;
  state: string;
  source: string;
};

export type FirmsSearchResult =
  | { ok: true; rows: FirmRow[]; totalRecords: number }
  | { ok: false; error: string };

const VALID_STATUS = new Set([
  "all",
  "active",
  "graduated",
  "terminated",
  "unknown",
]);

export async function searchFirmsAction(
  criteria: FirmsSearchCriteria,
): Promise<FirmsSearchResult> {
  await requireAuth();
  await requireCurrentOrg();

  if (process.env.AWARDS_INTEL_ENABLED !== "1") {
    return {
      ok: false,
      error: "Awards intel is in preview. Ask an admin to set AWARDS_INTEL_ENABLED=1.",
    };
  }

  const status = (criteria.status || "all").trim().toLowerCase();
  if (!VALID_STATUS.has(status)) {
    return { ok: false, error: "Invalid status filter." };
  }
  const certTypeFilter = (criteria.certType || "all").trim().toLowerCase();
  const naicsPrefix = (criteria.naicsPrefix || "").replace(/[^0-9]/g, "");
  const stateCode = (criteria.state || "").trim().toUpperCase().slice(0, 2);
  const nameKeyword = (criteria.nameKeyword || "").trim();
  const graduatedSinceMonths = Math.max(
    0,
    Math.min(120, Math.floor(criteria.graduatedSinceMonths ?? 0)),
  );
  const page = Math.max(1, Math.floor(criteria.page ?? 1));
  const limit = Math.min(200, Math.max(1, Math.floor(criteria.limit ?? 50)));

  return safeQuery<FirmsSearchResult>(
    async () => {
      const where: SQL<unknown>[] = [];
      if (status !== "all") {
        where.push(eq(certFirms.status, status));
      }
      if (certTypeFilter && certTypeFilter !== "all") {
        where.push(eq(certFirms.certType, certTypeFilter));
      }
      if (naicsPrefix) {
        where.push(ilike(certFirms.naicsPrimary, `${naicsPrefix}%`));
      }
      if (stateCode) {
        where.push(eq(certFirms.state, stateCode));
      }
      if (nameKeyword) {
        // Match anywhere; normalized name index covers the common case
        // implicitly via index seq-scan fall-back when ILIKE doesn't
        // hit the b-tree.
        where.push(ilike(certFirms.firmName, `%${nameKeyword}%`));
      }
      if (graduatedSinceMonths > 0) {
        const since = new Date();
        since.setMonth(since.getMonth() - graduatedSinceMonths);
        where.push(gte(certFirms.certExitDate, since));
        where.push(lt(certFirms.certExitDate, new Date()));
      }

      const whereExpr = where.length ? and(...where) : undefined;

      // Order: most-recently-graduated first when filtering on grad
      // window, otherwise alphabetical (stable, predictable for paging).
      const orderBy =
        graduatedSinceMonths > 0
          ? desc(certFirms.certExitDate)
          : asc(certFirms.firmName);

      const rows = await db
        .select()
        .from(certFirms)
        .where(whereExpr)
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(certFirms)
        .where(whereExpr);

      return {
        ok: true as const,
        rows: rows.map((r) => ({
          uei: r.uei,
          firmName: r.firmName,
          certType: r.certType,
          status: r.status,
          certEntryDate: r.certEntryDate
            ? r.certEntryDate.toISOString().slice(0, 10)
            : null,
          certExitDate: r.certExitDate
            ? r.certExitDate.toISOString().slice(0, 10)
            : null,
          naicsPrimary: r.naicsPrimary,
          city: r.city,
          state: r.state,
          source: r.source,
        })),
        totalRecords: count,
      };
    },
    {
      ok: true,
      rows: [],
      totalRecords: 0,
    },
    { tag: "searchFirmsAction" },
  );
}
