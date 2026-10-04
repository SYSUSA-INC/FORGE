/**
 * BL-FB-X-CRM Slice 2 — what an agency has been buying, from USAspending,
 * joined to the people we know there. On demand only (a user clicks
 * "Load"): the public API is slow and rate-limited, so nothing here runs
 * on page render or on a schedule. Gated behind AWARDS_INTEL_ENABLED like
 * the rest of the awards intelligence; audited as a sensitive read because
 * the request names a customer the tenant is working.
 *
 * Slice 3: the answer is kept per tenant for a day (`agency_history_cache`)
 * so the panel opens instantly and the API is asked at most once per
 * agency per day; "Refresh" bypasses the cache.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agencyHistoryCache, organizations, type AgencyHistoryPayload } from "@/db/schema";
import { recordRead } from "@/lib/audit-log";
import { agencyAwardAttempts, agencyKey, summarizeAgencyAwards } from "@/lib/crm-logic";
import { searchAwardsByCriteria } from "@/lib/usaspending";

type Actor = { userId: string | null; email?: string | null };

export type AgencyHistoryAward = AgencyHistoryPayload["awards"][number];

export type AgencyProcurementHistory =
  | ({ ok: true; cached: boolean; stale: boolean; fetchedAt: string } & AgencyHistoryPayload)
  | { ok: false; disabled?: true; error: string };

const PAGE = 25;
/** A cached answer this old is shown as stale and refetched on the next load. */
export const AGENCY_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

const enabled = () => process.env.AWARDS_INTEL_ENABLED === "1";

async function readCache(organizationId: string, key: string) {
  const [row] = await db
    .select({ payload: agencyHistoryCache.payload, fetchedAt: agencyHistoryCache.fetchedAt })
    .from(agencyHistoryCache)
    .where(and(eq(agencyHistoryCache.organizationId, organizationId), eq(agencyHistoryCache.agencyKey, key)))
    .limit(1);
  return row ?? null;
}

const fromCache = (row: { payload: AgencyHistoryPayload; fetchedAt: Date }, now: Date): AgencyProcurementHistory => ({
  ok: true,
  cached: true,
  stale: now.getTime() - row.fetchedAt.getTime() > AGENCY_HISTORY_TTL_MS,
  fetchedAt: row.fetchedAt.toISOString(),
  ...row.payload,
});

/** Slice 3 — what the tenant last fetched for this agency, without asking USAspending; null when nothing is cached. */
export async function cachedAgencyHistory(input: { organizationId: string; agency: string; now?: Date }): Promise<AgencyProcurementHistory | null> {
  const { organizationId } = input;
  if (!enabled()) return null;
  const key = agencyKey(input.agency);
  if (!key) return null;
  const row = await readCache(organizationId, key);
  return row ? fromCache(row, input.now ?? new Date()) : null;
}

/**
 * Recent contract awards by the agency, most valuable first. Tries the
 * agency name as a sub-tier and then a department, with the tenant's
 * NAICS first and then without; the first non-empty answer wins and is
 * cached for a day. `force` asks USAspending again regardless.
 */
export async function agencyProcurementHistory(input: { organizationId: string; agency: string; actor: Actor; now?: Date; force?: boolean }): Promise<AgencyProcurementHistory> {
  const { organizationId } = input;
  if (!enabled()) {
    return { ok: false, disabled: true, error: "Awards intel is in preview. Ask an admin to set AWARDS_INTEL_ENABLED=1." };
  }
  const agency = input.agency.trim().slice(0, 160);
  const key = agencyKey(agency);
  if (!agency || !key) return { ok: false, error: "This contact has no agency to look up." };
  const now = input.now ?? new Date();

  const cached = await readCache(organizationId, key);
  if (cached && !input.force && now.getTime() - cached.fetchedAt.getTime() <= AGENCY_HISTORY_TTL_MS) {
    return fromCache(cached, now);
  }

  const [org] = await db
    .select({ primaryNaics: organizations.primaryNaics, naicsList: organizations.naicsList })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const naics = Array.from(new Set([org?.primaryNaics ?? "", ...(org?.naicsList ?? [])].map((c) => c.trim()).filter(Boolean)));

  let lastError = "USAspending returned no awards for this agency.";
  for (const attempt of agencyAwardAttempts(agency, naics)) {
    const res = await searchAwardsByCriteria({ ...attempt, limit: PAGE, sort: "Award Amount", order: "desc" });
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    if (res.awards.length === 0) continue;
    const awards: AgencyHistoryAward[] = res.awards.map((a) => ({
      awardId: a.awardId,
      recipientName: a.recipientName,
      amount: a.amount,
      awardingSubAgency: a.awardingSubAgency,
      awardType: a.awardType,
      startDate: a.startDate,
      endDate: a.endDate,
      description: a.description.slice(0, 240),
      naicsCode: a.naicsCode,
      setAsideCode: a.setAsideCode,
      uiUrl: a.uiUrl,
    }));
    const payload: AgencyHistoryPayload = {
      agency,
      awards,
      summary: summarizeAgencyAwards(awards, now),
      totalRecords: res.totalRecords,
      naicsFiltered: !!attempt.naicsCodes?.length,
      matchedAs: attempt.awardingSubAgencyName ? "subagency" : "agency",
    };
    await db
      .insert(agencyHistoryCache)
      .values({ organizationId, agencyKey: key, agency, payload, fetchedAt: now })
      .onConflictDoUpdate({ target: [agencyHistoryCache.organizationId, agencyHistoryCache.agencyKey], set: { agency, payload, fetchedAt: now } });
    await recordRead({
      organizationId,
      actor: input.actor,
      action: "crm.agency.history",
      resourceType: "agency",
      resourceId: agency.slice(0, 128),
      metadata: { awards: awards.length, totalRecords: res.totalRecords, naicsFiltered: payload.naicsFiltered, matchedAs: payload.matchedAs, forced: !!input.force },
    });
    return { ok: true, cached: false, stale: false, fetchedAt: now.toISOString(), ...payload };
  }
  // Nothing live: an older answer still beats an empty panel.
  if (cached) return fromCache(cached, now);
  return { ok: false, error: lastError };
}
