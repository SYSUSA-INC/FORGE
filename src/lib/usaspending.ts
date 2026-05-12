/**
 * USAspending.gov client.
 *
 * Free public federal-spending API — no auth required, no rate
 * limit advertised. Documentation: https://api.usaspending.gov/
 *
 * We use the spending_by_award search to pull all federal contracts
 * (and grants/loans, optionally) won by a given recipient. Each
 * award becomes a candidate past-performance entry the user can
 * approve into the knowledge base.
 *
 * Award type codes:
 *   A — BPA Call
 *   B — Purchase Order
 *   C — Delivery Order
 *   D — Definitive Contract
 *   IDV (parent) types: IDV_A, IDV_B, IDV_C, IDV_D, IDV_E
 */

const BASE = "https://api.usaspending.gov/api/v2";

export type UsaspendingAward = {
  awardId: string;
  recipientName: string;
  /** Total obligated amount in USD. */
  amount: number;
  awardingAgency: string;
  awardingSubAgency: string;
  awardType: string;
  startDate: string | null;
  endDate: string | null;
  description: string;
  naicsCode: string;
  pscCode: string;
  /**
   * Set-aside type code as returned by USAspending (e.g. "8A", "HZC",
   * "WOSB"). Empty string if the award was full-and-open or USAspending
   * didn't expose the field. See SET_ASIDE_GROUPS for grouping codes
   * into human-friendly buckets.
   */
  setAsideCode: string;
  /** Stable URL to the contract page on usaspending.gov. */
  uiUrl: string;
};

export type UsaspendingSearchResult =
  | { ok: true; awards: UsaspendingAward[]; totalRecords: number }
  | { ok: false; error: string };

const CONTRACT_TYPE_CODES = ["A", "B", "C", "D"] as const;
const FIELDS = [
  "Award ID",
  "generated_internal_id",
  "Recipient Name",
  "Award Amount",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Period of Performance Start Date",
  "Period of Performance Current End Date",
  "Award Type",
  "Description",
  "NAICS",
  "psc_hierarchy",
  "PSC",
  "Type of Set Aside",
];

/**
 * Public, friendly set-aside groups. Each group maps to one or more
 * USAspending set-aside type codes — many program flavors (competed
 * vs. sole-source, partial vs. total) collapse into a single capture-
 * relevant bucket. The codes come from the FAR set-aside taxonomy
 * exposed by USAspending's `set_aside_type_codes` filter.
 */
export const SET_ASIDE_GROUPS = [
  { key: "8a", label: "8(a)", codes: ["8A", "8AN"] },
  { key: "hubzone", label: "HUBZone", codes: ["HZC", "HZS"] },
  { key: "wosb", label: "WOSB", codes: ["WOSB", "WOSBSS"] },
  { key: "edwosb", label: "EDWOSB", codes: ["EDWOSB", "EDWOSBSS"] },
  { key: "sdvosb", label: "SDVOSB", codes: ["SDVOSBC", "SDVOSBS"] },
  { key: "vosb", label: "VOSB", codes: ["VSA", "VSS"] },
  { key: "sb", label: "Small Business", codes: ["SBA", "SBP"] },
] as const;

export type SetAsideGroupKey = (typeof SET_ASIDE_GROUPS)[number]["key"];

/** Map a raw USAspending set-aside code back to its group label, or "" if unknown. */
export function setAsideLabel(code: string): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  const group = SET_ASIDE_GROUPS.find((g) =>
    (g.codes as readonly string[]).includes(upper),
  );
  return group ? group.label : upper;
}

/**
 * Search awards by recipient name. The name is fuzzy-matched
 * server-side, so "Acme" finds "Acme Corp", "Acme Solutions LLC",
 * etc. Pass a UEI as the name and it'll usually work too.
 */
export async function searchAwardsByRecipientName(
  recipientName: string,
  opts: { limit?: number; page?: number; includeIdv?: boolean } = {},
): Promise<UsaspendingSearchResult> {
  const trimmed = recipientName.trim();
  if (trimmed.length < 2) {
    return {
      ok: false,
      error: "Provide a recipient name (or UEI) of at least 2 characters.",
    };
  }

  const codes = opts.includeIdv
    ? [...CONTRACT_TYPE_CODES, "IDV_A", "IDV_B", "IDV_C", "IDV_D", "IDV_E"]
    : [...CONTRACT_TYPE_CODES];

  const body = {
    filters: {
      recipient_search_text: [trimmed],
      award_type_codes: codes,
      // Only include awards whose period of performance overlaps the
      // last 7 fiscal years — keeps the result set relevant for past
      // performance citations.
      time_period: [
        {
          start_date: yearsAgo(7),
          end_date: today(),
        },
      ],
    },
    fields: FIELDS,
    sort: "Award Amount",
    order: "desc",
    limit: Math.min(100, opts.limit ?? 25),
    page: opts.page ?? 1,
  };

  try {
    const res = await fetch(`${BASE}/search/spending_by_award/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const errBody = await res.text();
      return {
        ok: false,
        error: `USAspending ${res.status}: ${errBody.slice(0, 240)}`,
      };
    }
    const data = (await res.json()) as {
      results?: Record<string, unknown>[];
      page_metadata?: { total: number };
    };
    const results = data.results ?? [];
    return {
      ok: true,
      totalRecords: data.page_metadata?.total ?? results.length,
      awards: results.map(normalize).filter((a): a is UsaspendingAward => !!a),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalize(raw: Record<string, unknown>): UsaspendingAward | null {
  const awardId =
    pick(raw, "Award ID") ||
    pick(raw, "piid") ||
    pick(raw, "award_id_piid") ||
    "";
  if (!awardId) return null;

  const internalId = pick(raw, "generated_internal_id");
  const uiUrl = internalId
    ? `https://www.usaspending.gov/award/${encodeURIComponent(internalId)}`
    : `https://www.usaspending.gov/search?type=contract&piid=${encodeURIComponent(
        awardId,
      )}`;

  // Prefer top-level NAICS; some result shapes nest it under naics_hierarchy.
  let naics = pick(raw, "NAICS");
  if (!naics && raw.naics_hierarchy && typeof raw.naics_hierarchy === "object") {
    const h = raw.naics_hierarchy as Record<string, unknown>;
    naics = pick(h, "code") || pick(h, "toptier_code");
  }

  return {
    awardId,
    recipientName: pick(raw, "Recipient Name"),
    amount: numericPick(raw, "Award Amount"),
    awardingAgency: pick(raw, "Awarding Agency"),
    awardingSubAgency: pick(raw, "Awarding Sub Agency"),
    awardType: pick(raw, "Award Type"),
    startDate: pickDate(raw, "Period of Performance Start Date"),
    endDate: pickDate(raw, "Period of Performance Current End Date"),
    description: (pick(raw, "Description") || "").slice(0, 4000),
    naicsCode: naics,
    pscCode: pick(raw, "PSC"),
    setAsideCode: pick(raw, "Type of Set Aside").toUpperCase(),
    uiUrl,
  };
}

function pick(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function numericPick(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pickDate(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== "string" || !v) return null;
  // USAspending returns YYYY-MM-DD; accept ISO timestamps too.
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : v.slice(0, 10);
}

function yearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────────────
// BD intel — search by NAICS / agency / keyword (not recipient).
// Same upstream endpoint, different filter shape. Used by
// /intelligence/awards to surface incumbents and recompete signals
// for capture managers.
// ────────────────────────────────────────────────────────────────────

export type AwardsSearchCriteria = {
  naicsCodes?: string[];
  /** Toptier awarding agency name, e.g. "Department of Defense". */
  awardingAgencyName?: string;
  /** Subtier awarding agency name, e.g. "U.S. Army". */
  awardingSubAgencyName?: string;
  /** Free-text keyword search across description / PIID / etc. */
  keyword?: string;
  /** Defaults to A/B/C/D (no IDV vehicles). */
  awardTypeCodes?: string[];
  /**
   * Raw USAspending set-aside type codes to filter on (e.g. ["8A", "8AN"]).
   * Pass an empty array or omit to apply no set-aside filter. Use
   * `SET_ASIDE_GROUPS` from this module to expand friendly group keys
   * to the underlying codes.
   */
  setAsideCodes?: string[];
  /** Result-side filter on Period of Performance Current End Date (YYYY-MM-DD). */
  endDateBefore?: string | null;
  /** Result-side filter on Period of Performance Current End Date (YYYY-MM-DD). */
  endDateAfter?: string | null;
  /** action_date lower bound. Defaults to 7 fiscal years ago. */
  timePeriodStart?: string;
  /** action_date upper bound. Defaults to today. */
  timePeriodEnd?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
};

export async function searchAwardsByCriteria(
  criteria: AwardsSearchCriteria,
): Promise<UsaspendingSearchResult> {
  const naics = (criteria.naicsCodes ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const keyword = (criteria.keyword ?? "").trim();
  const agency = (criteria.awardingAgencyName ?? "").trim();
  const subAgency = (criteria.awardingSubAgencyName ?? "").trim();

  if (!naics.length && !keyword && !agency && !subAgency) {
    return {
      ok: false,
      error:
        "Provide at least one of: NAICS code, keyword, awarding agency, or sub-agency.",
    };
  }

  const codes = (criteria.awardTypeCodes ?? [...CONTRACT_TYPE_CODES]).filter(
    Boolean,
  );

  const filters: Record<string, unknown> = {
    award_type_codes: codes,
    time_period: [
      {
        start_date: criteria.timePeriodStart ?? yearsAgo(7),
        end_date: criteria.timePeriodEnd ?? today(),
      },
    ],
  };
  if (naics.length) filters.naics_codes = naics;
  if (keyword) filters.keywords = [keyword];
  const agencies: Array<{ type: string; tier: string; name: string }> = [];
  if (agency)
    agencies.push({ type: "awarding", tier: "toptier", name: agency });
  if (subAgency)
    agencies.push({ type: "awarding", tier: "subtier", name: subAgency });
  if (agencies.length) filters.agencies = agencies;
  const setAside = (criteria.setAsideCodes ?? [])
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (setAside.length) filters.set_aside_type_codes = setAside;

  const body = {
    filters,
    fields: FIELDS,
    // USAspending only allows a small set of fields as sort keys for
    // Contract Awards — "Period of Performance Current End Date" is
    // returnable but not sortable, so sort by amount and surface
    // recompete-relevant rows in the UI via isLikelyRecompete().
    sort: criteria.sort ?? "Award Amount",
    order: criteria.order ?? "desc",
    limit: Math.min(100, criteria.limit ?? 50),
    page: criteria.page ?? 1,
  };

  let result: UsaspendingSearchResult;
  try {
    const res = await fetch(`${BASE}/search/spending_by_award/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const errBody = await res.text();
      return {
        ok: false,
        error: `USAspending ${res.status}: ${errBody.slice(0, 240)}`,
      };
    }
    const data = (await res.json()) as {
      results?: Record<string, unknown>[];
      page_metadata?: { total: number };
    };
    const rows = data.results ?? [];
    result = {
      ok: true,
      totalRecords: data.page_metadata?.total ?? rows.length,
      awards: rows.map(normalize).filter((a): a is UsaspendingAward => !!a),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // USAspending's time_period filter is on action_date, not on
  // period_of_performance_current_end_date. The BD use case needs the
  // latter ("incumbents nearing recompete"), so we narrow client-side.
  if (result.ok && (criteria.endDateBefore || criteria.endDateAfter)) {
    const before = criteria.endDateBefore ?? null;
    const after = criteria.endDateAfter ?? null;
    result = {
      ok: true,
      totalRecords: result.totalRecords,
      awards: result.awards.filter((a) => {
        if (!a.endDate) return false;
        if (before && a.endDate > before) return false;
        if (after && a.endDate < after) return false;
        return true;
      }),
    };
  }
  return result;
}

/**
 * Heuristic: end date is within `withinDays` of today (and not lapsed
 * by more than 30 days), and the award type is a definitive contract
 * or delivery order (the recompete-able shapes).
 */
export function isLikelyRecompete(
  award: UsaspendingAward,
  withinDays = 365,
): boolean {
  if (!award.endDate) return false;
  const end = new Date(award.endDate).getTime();
  if (Number.isNaN(end)) return false;
  const now = Date.now();
  const horizon = now + withinDays * 24 * 60 * 60 * 1000;
  const lapsedTooLong = now - 30 * 24 * 60 * 60 * 1000;
  if (end > horizon) return false;
  if (end < lapsedTooLong) return false;
  const t = (award.awardType || "").toUpperCase();
  return (
    t === "C" ||
    t === "D" ||
    t.includes("DEFINITIVE") ||
    t.includes("DELIVERY ORDER")
  );
}
