/**
 * SBA 8(a) participant registry — fetch + normalize.
 *
 * Source: SAM.gov Entity Management API
 *   GET https://api.sam.gov/entity-information/v3/entities
 *       ?api_key=<SAMGOV_API_KEY>
 *       &sbaBusinessTypeCode=A6        <-- 8(a) Program Participant
 *       &samRegistered=Yes
 *       &page=<n>&size=100
 *
 * The SAM Entity API exposes each registered entity's socioeconomic
 * "sbaBusinessTypeList", where each entry has:
 *   - sbaBusinessTypeCode  (e.g. "A6" for 8(a))
 *   - sbaBusinessTypeDesc
 *   - certificationEntryDate
 *   - certificationExitDate
 *
 * Code A6 is the 8(a) certification. We pull all currently-registered
 * entities with that code and upsert them into `sba_8a_participant`.
 *
 * "Currently registered" misses graduates whose SAM registration has
 * lapsed, but those are also no longer pursuing federal contracts in
 * any active sense, so missing them is a fine trade-off. Operators can
 * always backfill via the manual-CSV path for historical analysis.
 *
 * The API requires a free SAM.gov API key set in `SAMGOV_API_KEY`
 * (same env var used by src/lib/samgov.ts for entity registration
 * lookups — single key, two consumers). Rate limit on the free tier
 * is ~1000 requests/day, which more than covers the few hundred pages
 * of 8(a) firms (~10K participants at 100/page).
 */

const SAM_BASE = "https://api.sam.gov/entity-information/v3/entities";
const PAGE_SIZE = 100;
/** SBA business-type code for "8(a) Program Participant". */
const CODE_8A = "A6";

export type Sba8aRow = {
  uei: string;
  firmName: string;
  firmNameNorm: string;
  certEntryDate: Date | null;
  certExitDate: Date | null;
  /** 'active' | 'graduated' | 'terminated' | 'unknown' */
  status: string;
  naicsPrimary: string;
  city: string;
  state: string;
  source: string;
  sourceUpdatedAt: Date;
};

export type Sba8aFetchResult =
  | { ok: true; rows: Sba8aRow[]; totalRecords: number }
  | { ok: false; error: string };

/**
 * Normalize a firm name into a stable match key. Uppercased, with
 * punctuation and common legal suffixes stripped so "Acme Corp.",
 * "ACME CORP", and "ACME CORPORATION" all collapse to "ACME".
 */
export function normalizeFirmName(name: string): string {
  if (!name) return "";
  let n = name.toUpperCase();
  // Strip punctuation, normalize whitespace.
  n = n.replace(/[.,'"&/()-]/g, " ").replace(/\s+/g, " ").trim();
  // Strip common legal suffixes from the tail.
  const suffixes = [
    "INCORPORATED",
    "CORPORATION",
    "LIMITED LIABILITY COMPANY",
    "LIMITED",
    "COMPANY",
    "CORP",
    "INC",
    "LLC",
    "LLP",
    "LP",
    "LTD",
    "CO",
    "PLLC",
    "PC",
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of suffixes) {
      if (n.endsWith(" " + suf)) {
        n = n.slice(0, -suf.length - 1).trim();
        changed = true;
        break;
      }
    }
  }
  return n;
}

/**
 * Pull one page of 8(a) participants from SAM.gov. Returns the parsed
 * rows and the total record count (for pagination). On non-200 the
 * upstream error body is included in the returned `error`.
 */
export async function fetchSba8aPage(
  apiKey: string,
  page: number,
): Promise<Sba8aFetchResult> {
  if (!apiKey.trim()) {
    return { ok: false, error: "SAMGOV_API_KEY not set." };
  }
  const url =
    `${SAM_BASE}?api_key=${encodeURIComponent(apiKey)}` +
    `&sbaBusinessTypeCode=${CODE_8A}` +
    `&samRegistered=Yes` +
    `&size=${PAGE_SIZE}` +
    `&page=${page}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: `SAM.gov ${res.status}: ${body.slice(0, 240)}`,
    };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: `SAM.gov returned non-JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const envelope = data as {
    totalRecords?: number;
    entityData?: unknown[];
  };
  const rows = (envelope.entityData ?? [])
    .map((e) => normalizeSamEntity(e))
    .filter((r): r is Sba8aRow => !!r);
  return {
    ok: true,
    rows,
    totalRecords: envelope.totalRecords ?? rows.length,
  };
}

/**
 * Normalize one SAM Entity record into our Sba8aRow shape. Returns
 * null if the record has no UEI or no 8(a) entry in its socioeconomic
 * list (defensive — the API filter should already exclude those).
 */
export function normalizeSamEntity(raw: unknown): Sba8aRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const entityRegistration =
    pickObject(r, "entityRegistration") ?? r;
  const coreData = pickObject(r, "coreData") ?? {};
  const assertions = pickObject(r, "assertions") ?? {};

  const uei = (
    pickString(entityRegistration, "ueiSAM") ||
    pickString(r, "ueiSAM") ||
    pickString(r, "uei")
  ).trim();
  if (!uei) return null;

  const firmName = (
    pickString(entityRegistration, "legalBusinessName") ||
    pickString(r, "legalBusinessName") ||
    pickString(r, "dbaName")
  ).trim();
  if (!firmName) return null;

  // 8(a) entry is one row of sbaBusinessTypeList.
  const sbaList = arrayOfObjects(
    pickArray(assertions, "sbaBusinessTypeList") ??
      pickArray(r, "sbaBusinessTypeList"),
  );
  const eightA = sbaList.find(
    (s) =>
      (pickString(s, "sbaBusinessTypeCode") || "").trim().toUpperCase() ===
      CODE_8A,
  );
  if (!eightA) return null;

  const certEntryDate = parseDate(pickString(eightA, "certificationEntryDate"));
  const certExitDate = parseDate(pickString(eightA, "certificationExitDate"));

  // Status derivation:
  //   - exit date in the past  → 'graduated'
  //   - exit date in the future → 'active'
  //   - missing both dates     → 'unknown'
  const now = new Date();
  let status = "unknown";
  if (certExitDate) {
    status = certExitDate.getTime() < now.getTime() ? "graduated" : "active";
  } else if (certEntryDate) {
    status = "active";
  }

  const naicsList = arrayOfObjects(
    pickArray(assertions, "goodsAndServices") ??
      pickArray(coreData, "naicsList") ??
      pickArray(r, "naicsList"),
  );
  // First NAICS marked primary, or just the first one.
  const primary =
    naicsList.find((n) => pickString(n, "isPrimary") === "Y") ??
    naicsList[0];
  const naicsPrimary = primary
    ? pickString(primary, "naicsCode") || pickString(primary, "code")
    : "";

  const physicalAddress =
    pickObject(coreData, "physicalAddress") ??
    pickObject(r, "physicalAddress") ??
    {};
  const city = pickString(physicalAddress, "city");
  const state =
    pickString(physicalAddress, "stateOrProvinceCode") ||
    pickString(physicalAddress, "state");

  return {
    uei,
    firmName,
    firmNameNorm: normalizeFirmName(firmName),
    certEntryDate,
    certExitDate,
    status,
    naicsPrimary,
    city,
    state,
    source: "sam.gov",
    sourceUpdatedAt: new Date(),
  };
}

/**
 * Normalize an array of CSV-paste rows (after PapaParse-style header
 * detection upstream) into Sba8aRow shape. Used by the manual import
 * path so operators can drop a CSV in when the SAM API is down or
 * unconfigured. Header names are case-insensitive and accept a few
 * common aliases.
 */
export function normalizeCsvRow(raw: Record<string, string>): Sba8aRow | null {
  const lc: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    lc[k.toLowerCase().trim()] = (v ?? "").trim();
  }
  const uei = lc["uei"] || lc["uei sam"] || lc["uei_sam"] || lc["sam uei"];
  const firmName =
    lc["firm name"] ||
    lc["firm_name"] ||
    lc["legal business name"] ||
    lc["legalbusinessname"] ||
    lc["company name"];
  if (!uei || !firmName) return null;
  const certEntryDate = parseDate(
    lc["cert entry date"] ||
      lc["certification entry date"] ||
      lc["certificationentrydate"] ||
      lc["entry date"],
  );
  const certExitDate = parseDate(
    lc["cert exit date"] ||
      lc["certification exit date"] ||
      lc["certificationexitdate"] ||
      lc["exit date"] ||
      lc["graduation date"],
  );
  const now = new Date();
  let status = "unknown";
  if (certExitDate) {
    status = certExitDate.getTime() < now.getTime() ? "graduated" : "active";
  } else if (certEntryDate) {
    status = "active";
  }
  return {
    uei,
    firmName,
    firmNameNorm: normalizeFirmName(firmName),
    certEntryDate,
    certExitDate,
    status,
    naicsPrimary: lc["naics"] || lc["naics primary"] || lc["primary naics"] || "",
    city: lc["city"] || "",
    state: lc["state"] || lc["state or province"] || "",
    source: "manual_csv",
    sourceUpdatedAt: new Date(),
  };
}

// ── chip lookup ──────────────────────────────────────────────────────

/**
 * The display-side projection of an 8(a) participant — what the row
 * chip on an award/firm listing needs to know. Smaller than the full
 * DB row, and computed once per search batch.
 */
export type Sba8aChip = {
  uei: string;
  firmName: string;
  status: string;
  certExitDate: Date | null;
  /** 'uei' (exact) or 'name' (fuzzy fallback). */
  matchedBy: "uei" | "name";
};

/**
 * Given a batch of recipients (UEI + name pairs from an award list),
 * return a Map keyed by the recipient's UEI (or normalized name if UEI
 * is missing) pointing to the matched participant. Pure function over
 * an in-memory participant catalogue so the caller controls DB IO.
 */
export function buildSba8aChipIndex(
  recipients: { uei: string; name: string }[],
  catalogue: Sba8aRow[],
): Map<string, Sba8aChip> {
  const byUei = new Map<string, Sba8aRow>();
  const byName = new Map<string, Sba8aRow>();
  for (const row of catalogue) {
    if (row.uei) byUei.set(row.uei.toUpperCase(), row);
    if (row.firmNameNorm) byName.set(row.firmNameNorm, row);
  }
  const out = new Map<string, Sba8aChip>();
  for (const r of recipients) {
    const uei = (r.uei || "").toUpperCase().trim();
    const nameKey = normalizeFirmName(r.name || "");
    let hit: Sba8aRow | undefined;
    let matchedBy: "uei" | "name" = "uei";
    if (uei) {
      hit = byUei.get(uei);
    }
    if (!hit && nameKey) {
      hit = byName.get(nameKey);
      matchedBy = "name";
    }
    if (!hit) continue;
    out.set(uei || nameKey, {
      uei: hit.uei,
      firmName: hit.firmName,
      status: hit.status,
      certExitDate: hit.certExitDate,
      matchedBy,
    });
  }
  return out;
}

/** Stable lookup key for an award's recipient — UEI when known, else normalized name. */
export function sba8aRecipientKey(recipient: { uei?: string; name: string }): string {
  const uei = (recipient.uei || "").toUpperCase().trim();
  return uei || normalizeFirmName(recipient.name || "");
}

// ── helpers ──────────────────────────────────────────────────────────

function pickString(obj: Record<string, unknown> | null, key: string): string {
  if (!obj) return "";
  const v = obj[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function pickObject(
  obj: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (!obj) return null;
  const v = obj[key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function pickArray(
  obj: Record<string, unknown> | null,
  key: string,
): unknown[] | null {
  if (!obj) return null;
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}

function arrayOfObjects(a: unknown[] | null): Record<string, unknown>[] {
  if (!a) return [];
  return a.filter(
    (x): x is Record<string, unknown> =>
      !!x && typeof x === "object" && !Array.isArray(x),
  );
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  // SAM returns YYYY-MM-DD; some CSV exports use MM/DD/YYYY.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = new Date(`${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
    return Number.isNaN(dd.getTime()) ? null : dd;
  }
  return null;
}
