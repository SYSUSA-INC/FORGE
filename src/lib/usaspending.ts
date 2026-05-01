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
];

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
