/**
 * SBA 8(a) participant registry — fetch + normalize.
 *
 * Source: SAM.gov Entity Management API
 *   GET https://api.sam.gov/entity-information/v4/entities
 *       ?api_key=<SAMGOV_API_KEY>
 *       &sbaBusinessTypeCode=A6        <-- 8(a) Program Participant
 *       &samRegistered=Yes
 *       &page=<n>&size=10
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
 * lookups — single key, two consumers).
 *
 * Tier limits on the public/free key:
 *   - 10 records per page (size capped at 10, larger requests 400)
 *   - 1000 requests/day
 *
 * At 10 records/page, the full 8(a) registry (~10K firms) takes ~1000
 * page calls — exactly the daily ceiling. The admin import UI batches
 * 20-30 pages per click to stay under the Vercel serverless timeout
 * while making meaningful progress per click. System-account keys
 * (which require an SAM application) lift size to 100 if higher
 * throughput becomes necessary.
 */

const SAM_BASE = "https://api.sam.gov/entity-information/v4/entities";
/**
 * Max records per page. Public/free SAM.gov tier caps this at 10
 * (returns HTTP 400 with errorCode SCE for anything larger). System-
 * account tier allows 100. We stick to 10 for the free-tier default.
 */
const PAGE_SIZE = 10;

/**
 * Mapping from internal `cert_type` keys to SAM.gov's
 * `sbaBusinessTypeCode` filter values plus a human label.
 *
 * Codes come from the SAM Entity Management data dictionary
 * (also surfaced as part of each entity's `coreData.businessTypes
 * .sbaBusinessTypeList[].sbaBusinessTypeCode`). The high-confidence
 * codes are `verified: true`; the others are best-guess values that
 * may need adjustment after production validation. Codes that turn
 * out wrong manifest as a successful Pull batch with zero rows
 * (totalRecords also drops to whatever the upstream returns for the
 * unrecognised filter).
 */
export type CertSpec = {
  certType: string;
  label: string;
  samBusinessTypeCode: string;
  verified: boolean;
};

export const CERT_SPECS: readonly CertSpec[] = [
  { certType: "8a",             label: "8(a)",              samBusinessTypeCode: "A6", verified: true },
  { certType: "wosb",           label: "WOSB",              samBusinessTypeCode: "A5", verified: true },
  { certType: "edwosb",         label: "EDWOSB",            samBusinessTypeCode: "A4", verified: true },
  { certType: "sdvosb",         label: "SDVOSB",            samBusinessTypeCode: "QF", verified: false },
  { certType: "vob",            label: "Veteran Owned",     samBusinessTypeCode: "A2", verified: false },
  { certType: "hubzone",        label: "HUBZone",           samBusinessTypeCode: "XX", verified: false },
  { certType: "native_american",label: "Native American",   samBusinessTypeCode: "T1", verified: false },
];

export function certSpecFor(certType: string): CertSpec | null {
  return CERT_SPECS.find((c) => c.certType === certType) ?? null;
}

export type Sba8aRow = {
  uei: string;
  firmName: string;
  firmNameNorm: string;
  /**
   * Cert type this row belongs to ('8a' | 'hubzone' | 'wosb' | etc.).
   * Today this function only emits '8a' rows since the SAM filter is
   * hardcoded to A6; PR B will parameterise the filter and start
   * emitting other cert types. The field lives on the row now so
   * downstream upsert code can target the composite (uei, cert_type)
   * unique without further plumbing changes.
   */
  certType: string;
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
  | {
      ok: true;
      rows: Sba8aRow[];
      totalRecords: number;
      /**
       * First ~1KB of the raw upstream response body. Surfaced through
       * the admin UI when `rows` is empty so the operator (and the
       * developer reading their report) can see exactly what SAM.gov
       * returned — invaluable for diagnosing tier-related empty
       * responses where the request succeeds but yields no data.
       */
      debugRawSample: string;
      /** Detected top-level keys in the JSON envelope, for diagnostics. */
      debugTopLevelKeys: string[];
      /**
       * Per-entity trace of normalizeSamEntity decisions on the first
       * 3 entities. Only populated when rows is empty — lets us see
       * exactly which gate rejected the entity vs. what the function
       * read from each field.
       */
      debugNormalizeTrace: NormalizeTrace[];
    }
  | { ok: false; error: string };

export type NormalizeTrace = {
  index: number;
  rawKeys: string[];
  entityRegKeys: string[];
  coreDataKeys: string[];
  ueiSeen: string;
  firmNameSeen: string;
  reason: "ok" | "no-uei" | "no-firmname" | "not-object";
};

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
 *
 * Pagination convention: callers pass 1-based page numbers ("page 1
 * = first page") for operator-friendliness in the admin UI. SAM.gov
 * is internally 0-based, so we subtract one when building the URL.
 * Caller-facing nextPage values stay 1-based.
 */
export async function fetchSba8aPage(
  apiKey: string,
  page: number,
  certType: string = "8a",
): Promise<Sba8aFetchResult> {
  if (!apiKey.trim()) {
    return { ok: false, error: "SAMGOV_API_KEY not set." };
  }
  const spec = certSpecFor(certType);
  if (!spec) {
    return { ok: false, error: `Unknown cert type '${certType}'.` };
  }
  // SAM.gov is 0-based; admin UI is 1-based. Convert here so the rest
  // of the system can think in plain "page 1 / 2 / 3" terms.
  const samPage = Math.max(0, page - 1);
  const url =
    `${SAM_BASE}?api_key=${encodeURIComponent(apiKey)}` +
    `&sbaBusinessTypeCode=${spec.samBusinessTypeCode}` +
    `&samRegistered=Yes` +
    // registrationStatus=A filters to currently-Active SAM
    // registrations. The Entity API silently returns empty entityData
    // for filtered-out totals if this is missing — matches the
    // behaviour of src/lib/samgov.ts entity searches.
    `&registrationStatus=A` +
    `&size=${PAGE_SIZE}` +
    `&page=${samPage}`;
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
  // Read once as text so we can include a sample in debug output even
  // when JSON parsing succeeds — needed to diagnose the empty-data
  // tier-limit case.
  const rawText = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    return {
      ok: false,
      error:
        `SAM.gov returned non-JSON: ${err instanceof Error ? err.message : String(err)}. ` +
        `Body sample: ${rawText.slice(0, 240)}`,
    };
  }
  const envelope = data as {
    totalRecords?: number;
    entityData?: unknown[];
  };
  const rows = (envelope.entityData ?? [])
    .map((e) => normalizeSamEntity(e, certType))
    .filter((r): r is Sba8aRow => !!r);
  const debugTopLevelKeys =
    data && typeof data === "object" && !Array.isArray(data)
      ? Object.keys(data as Record<string, unknown>)
      : [];

  // Trace the first 3 entities to surface what normalizeSamEntity saw
  // when rows ends up empty. Only matters in the failure case.
  const debugNormalizeTrace: NormalizeTrace[] =
    rows.length === 0
      ? (envelope.entityData ?? [])
          .slice(0, 3)
          .map((e, index) => traceNormalize(e, index))
      : [];

  return {
    ok: true,
    rows,
    totalRecords: envelope.totalRecords ?? rows.length,
    debugRawSample: rawText.slice(0, 1024),
    debugTopLevelKeys,
    debugNormalizeTrace,
  };
}

/**
 * Mirrors normalizeSamEntity but emits a trace record instead of a row.
 * Used only when the live import returns zero rows so we can see what
 * the function actually saw on each entity, vs the raw JSON the
 * /admin/sba-8a diagnostic surface shows.
 */
function traceNormalize(raw: unknown, index: number): NormalizeTrace {
  if (!raw || typeof raw !== "object") {
    return {
      index,
      rawKeys: [],
      entityRegKeys: [],
      coreDataKeys: [],
      ueiSeen: "",
      firmNameSeen: "",
      reason: "not-object",
    };
  }
  const r = raw as Record<string, unknown>;
  const rawKeys = Object.keys(r);
  const entityRegistration = pickObject(r, "entityRegistration") ?? r;
  const coreData = pickObject(r, "coreData") ?? {};
  const uei = (
    pickString(entityRegistration, "ueiSAM") ||
    pickString(r, "ueiSAM") ||
    pickString(r, "uei")
  ).trim();
  const firmName = (
    pickString(entityRegistration, "legalBusinessName") ||
    pickString(r, "legalBusinessName") ||
    pickString(r, "dbaName")
  ).trim();
  const trace: NormalizeTrace = {
    index,
    rawKeys,
    entityRegKeys: Object.keys(entityRegistration),
    coreDataKeys: Object.keys(coreData),
    ueiSeen: uei,
    firmNameSeen: firmName,
    reason: "ok",
  };
  if (!uei) trace.reason = "no-uei";
  else if (!firmName) trace.reason = "no-firmname";
  return trace;
}

/**
 * Normalize one SAM Entity record into our Sba8aRow shape. Returns
 * null only when essential identity fields (UEI, firm name) are
 * missing. We trust the upstream filter (sbaBusinessTypeCode=A6) for
 * 8(a) membership rather than re-validating it from the response —
 * v4 returns the businessTypes section but historically has shipped
 * with the section omitted, so requiring its presence as a gate
 * would silently discard every row.
 */
export function normalizeSamEntity(
  raw: unknown,
  certType: string = "8a",
): Sba8aRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const entityRegistration =
    pickObject(r, "entityRegistration") ?? r;
  const coreData = pickObject(r, "coreData") ?? {};
  const businessTypes = pickObject(coreData, "businessTypes") ?? {};

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

  // 8(a) entry lives under coreData.businessTypes.sbaBusinessTypeList
  // in v4 (same path used by src/lib/samgov.ts entity searches). When
  // present, mine cert dates from it; when absent, fall through and
  // infer status from registration state.
  const sbaList = arrayOfObjects(
    pickArray(businessTypes, "sbaBusinessTypeList") ??
      pickArray(coreData, "sbaBusinessTypeList") ??
      pickArray(r, "sbaBusinessTypeList"),
  );
  // Find the cert entry matching the certType being pulled. The SAM
  // filter already narrowed entities to ones holding this cert, but
  // mining the per-cert dates requires picking the right list entry.
  const certSpec = certSpecFor(certType);
  const targetCode = (certSpec?.samBusinessTypeCode ?? "").toUpperCase();
  const eightA = sbaList.find(
    (s) =>
      (pickString(s, "sbaBusinessTypeCode") || "").trim().toUpperCase() ===
      targetCode,
  );

  const certEntryDate = eightA
    ? parseDate(pickString(eightA, "certificationEntryDate"))
    : null;
  const certExitDate = eightA
    ? parseDate(pickString(eightA, "certificationExitDate"))
    : null;

  // Status derivation:
  //   - exit date in the past   → 'graduated'
  //   - exit date in the future → 'active'
  //   - cert entry date only    → 'active' (still in the program)
  //   - no cert dates but SAM   → 'active' (filter guaranteed 8(a))
  //     registration active
  //   - everything else         → 'unknown'
  const now = new Date();
  let status = "unknown";
  if (certExitDate) {
    status = certExitDate.getTime() < now.getTime() ? "graduated" : "active";
  } else if (certEntryDate) {
    status = "active";
  } else {
    const regStatus = pickString(entityRegistration, "registrationStatus")
      .trim()
      .toLowerCase();
    if (regStatus === "active") status = "active";
  }

  // NAICS: prefer coreData.naicsInformation.primaryNaics (v4
  // canonical), fall back to older shapes for resilience.
  const naicsInformation = pickObject(coreData, "naicsInformation") ?? {};
  const naicsList = arrayOfObjects(
    pickArray(naicsInformation, "naicsList") ??
      pickArray(coreData, "naicsList") ??
      pickArray(r, "naicsList"),
  );
  const naicsFromList = naicsList.find(
    (n) => pickString(n, "isPrimary") === "Y",
  ) ?? naicsList[0];
  const naicsPrimary =
    pickString(naicsInformation, "primaryNaics") ||
    (naicsFromList
      ? pickString(naicsFromList, "naicsCode") ||
        pickString(naicsFromList, "code")
      : "");

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
    certType,
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
export function normalizeCsvRow(
  raw: Record<string, string>,
  certType: string = "8a",
): Sba8aRow | null {
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
    certType,
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
