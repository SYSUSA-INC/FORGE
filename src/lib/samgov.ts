const SAM_BASE = "https://api.sam.gov/entity-information/v4/entities";

/**
 * SAM.gov Entity Management API hard-caps `size` at 10 records per
 * request. Going higher returns HTTP 400 with errorCode SCE.
 * (The Opportunities API on a different endpoint allows up to 1000.)
 */
export const MAX_ENTITY_SEARCH_SIZE = 10;

type SamRawEntity = {
  entityRegistration?: {
    legalBusinessName?: string;
    ueiSAM?: string;
    cageCode?: string;
    dunsNumber?: string;
    registrationStatus?: string;
    registrationExpirationDate?: string;
  };
  coreData?: {
    entityInformation?: { entityURL?: string };
    physicalAddress?: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateOrProvinceCode?: string;
      zipCode?: string;
      zipCodePlus4?: string;
      countryCode?: string;
    };
    businessTypes?: {
      sbaBusinessTypeList?: {
        sbaBusinessTypeCode?: string;
        sbaBusinessTypeDesc?: string;
      }[];
    };
    naicsInformation?: {
      primaryNaics?: string;
      naicsList?: { naicsCode?: string; naicsDescription?: string }[];
    };
  };
  pointsOfContact?: {
    governmentBusinessPOC?: {
      firstName?: string;
      lastName?: string;
      title?: string;
      telephoneNumber?: string;
      email?: string;
    };
    electronicBusinessPOC?: {
      firstName?: string;
      lastName?: string;
      title?: string;
      telephoneNumber?: string;
      email?: string;
    };
  };
};

type SocioMap = {
  sba8a: boolean;
  smallBusiness: boolean;
  sdb: boolean;
  wosb: boolean;
  sdvosb: boolean;
  hubzone: boolean;
};

export type NormalizedSamEntity = {
  name: string;
  website: string;
  uei: string;
  cageCode: string;
  dunsNumber: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
  primaryNaics: string;
  naicsList: string[];
  socioEconomic: SocioMap;
  registrationStatus: string;
  registrationExpirationDate: string;
  sbaDescriptions: string[];
};

function mapSbaCodeToFlag(code: string): keyof SocioMap | null {
  const table: Record<string, keyof SocioMap> = {
    XX: "sba8a",
    A6: "sba8a",
    A2: "wosb",
    "27": "sdb",
    QF: "sdvosb",
    "JV SDVOSB": "sdvosb",
    QZ: "hubzone",
    A8: "smallBusiness",
  };
  return table[code] ?? null;
}

export function normalizeSamEntity(raw: SamRawEntity): NormalizedSamEntity {
  const reg = raw.entityRegistration ?? {};
  const core = raw.coreData ?? {};
  const addr = core.physicalAddress ?? {};
  const naics = core.naicsInformation ?? {};
  const sbaList = core.businessTypes?.sbaBusinessTypeList ?? [];
  const pocGov = raw.pointsOfContact?.governmentBusinessPOC;
  const pocEb = raw.pointsOfContact?.electronicBusinessPOC;
  const poc = pocGov ?? pocEb;

  const socio: SocioMap = {
    sba8a: false,
    smallBusiness: false,
    sdb: false,
    wosb: false,
    sdvosb: false,
    hubzone: false,
  };
  for (const b of sbaList) {
    const flag = mapSbaCodeToFlag(b.sbaBusinessTypeCode ?? "");
    if (flag) socio[flag] = true;
  }

  const zip =
    addr.zipCodePlus4 && addr.zipCode
      ? `${addr.zipCode}-${addr.zipCodePlus4}`
      : (addr.zipCode ?? "");

  return {
    name: reg.legalBusinessName ?? "",
    website: core.entityInformation?.entityURL ?? "",
    uei: reg.ueiSAM ?? "",
    cageCode: reg.cageCode ?? "",
    dunsNumber: reg.dunsNumber ?? "",
    address: {
      line1: addr.addressLine1 ?? "",
      line2: addr.addressLine2 ?? "",
      city: addr.city ?? "",
      state: addr.stateOrProvinceCode ?? "",
      zip,
      country: addr.countryCode ?? "USA",
    },
    contactName: poc ? `${poc.firstName ?? ""} ${poc.lastName ?? ""}`.trim() : "",
    contactTitle: poc?.title ?? "",
    phone: poc?.telephoneNumber ?? "",
    email: poc?.email ?? "",
    primaryNaics: naics.primaryNaics ?? "",
    naicsList: (naics.naicsList ?? []).map((n) => n.naicsCode ?? "").filter(Boolean),
    socioEconomic: socio,
    registrationStatus: reg.registrationStatus ?? "",
    registrationExpirationDate: reg.registrationExpirationDate ?? "",
    sbaDescriptions: sbaList.map((b) => b.sbaBusinessTypeDesc ?? "").filter(Boolean),
  };
}

export async function fetchSamGovByUei(
  uei: string,
): Promise<
  | { ok: true; profile: NormalizedSamEntity }
  | { ok: false; error: string; status?: number }
> {
  const key = process.env.SAMGOV_API_KEY;
  if (!key) {
    return { ok: false, error: "SAMGOV_API_KEY not configured on the server." };
  }
  if (!uei) return { ok: false, error: "Provide a UEI." };

  const params = new URLSearchParams({
    api_key: key,
    samRegistered: "Yes",
    page: "0",
    size: "1",
    ueiSAM: uei,
  });

  try {
    const res = await fetch(`${SAM_BASE}?${params.toString()}`, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: friendlySamError(text, res.status),
        status: res.status,
      };
    }
    const data = JSON.parse(text) as {
      totalRecords?: number;
      entityData?: SamRawEntity[];
    };
    const first = data.entityData?.[0];
    if (!first) {
      return { ok: false, error: "No matching registered entity found in SAM.gov." };
    }
    return { ok: true, profile: normalizeSamEntity(first) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const SAM_OPP_BASE = "https://api.sam.gov/opportunities/v2/search";

export type SamOpportunity = {
  noticeId: string;
  title: string;
  solicitationNumber: string;
  department: string;
  subTier: string;
  office: string;
  postedDate: string;
  type: string;
  baseType: string;
  archiveType: string;
  archiveDate: string | null;
  typeOfSetAsideDescription: string;
  typeOfSetAside: string;
  responseDeadLine: string | null;
  naicsCode: string;
  classificationCode: string;
  active: string;
  placeOfPerformance: { city?: { name?: string }; state?: { name?: string }; country?: { name?: string } } | null;
  description: string;
  uiLink: string;
  award: { number?: string; amount?: string; date?: string } | null;
};

export type SamOpportunitySearchParams = {
  naicsCodes?: string[];
  keyword?: string;
  postedDaysBack?: number;
  activeOnly?: boolean;
  limit?: number;
  /**
   * Restrict to a specific contracting department, matched against
   * SAM.gov's `deptname` parameter. For GSA-issued opportunities use
   * "General Services Administration" exactly.
   */
  department?: string;
  /**
   * Free-text keywords to OR-merge into the `q` parameter. We use this
   * to bias toward GSA contract vehicles (Polaris, OASIS+, STARS III,
   * etc.) without forcing the user to remember exact strings.
   */
  extraKeywords?: string[];
  /**
   * SAM.gov sometimes returns description as a URL pointing to a
   * noticedesc endpoint. When true (default), we resolve those URLs
   * into actual descriptions before returning.
   */
  enrichDescriptions?: boolean;
};

// GSA vehicle list lives in @/lib/gsa-vehicles so it can be safely
// imported from client components without dragging the SAM.gov fetch
// code into the browser bundle.
export { GSA_VEHICLES, type GSAVehicle } from "@/lib/gsa-vehicles";

function mmddyyyy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/**
 * SAM.gov returns errors as JSON like
 *   { httpStatus, title, detail, type, errorCode, source }
 * Surface that in a human-readable line; fall back to the raw body
 * (truncated) if the response isn't JSON. Keeps the UI from showing
 * a wall of unparsed JSON to end users when SAM.gov rejects a query.
 */
function friendlySamError(body: string, httpStatus: number): string {
  try {
    const j = JSON.parse(body) as {
      title?: string;
      detail?: string;
      errorCode?: string;
      source?: string;
    };
    const parts = [
      j.detail ?? j.title ?? "",
      j.errorCode ? `[${j.errorCode}]` : "",
      j.source ? `· ${j.source}` : "",
    ]
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  } catch {
    // Not JSON; fall through.
  }
  return `SAM.gov ${httpStatus}: ${body.slice(0, 300)}`;
}

export async function searchSamGovOpportunities(
  input: SamOpportunitySearchParams,
): Promise<
  | { ok: true; opportunities: SamOpportunity[]; totalRecords: number }
  | { ok: false; error: string; status?: number }
> {
  const key = process.env.SAMGOV_API_KEY;
  if (!key) {
    return { ok: false, error: "SAMGOV_API_KEY not configured on the server." };
  }

  const postedTo = new Date();
  const postedFrom = new Date();
  postedFrom.setDate(postedFrom.getDate() - (input.postedDaysBack ?? 30));

  const params = new URLSearchParams({
    api_key: key,
    limit: String(input.limit ?? 50),
    postedFrom: mmddyyyy(postedFrom),
    postedTo: mmddyyyy(postedTo),
  });

  // SAM.gov's `q` is a single string. We default to AND semantics on
  // multi-word keywords by prefixing each token with "+" (Lucene-style
  // required term). Multi-word phrases stay quoted so we don't break
  // them apart. Vehicle hints OR into the same query.
  const userKeyword = input.keyword?.trim() ?? "";
  const keywordParts: string[] = [];
  if (userKeyword) keywordParts.push(buildAndKeyword(userKeyword));
  if (input.extraKeywords && input.extraKeywords.length > 0) {
    const quoted = input.extraKeywords
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => (k.includes(" ") ? `"${k}"` : k));
    if (quoted.length > 0) keywordParts.push(`(${quoted.join(" OR ")})`);
  }
  if (keywordParts.length > 0) params.set("q", keywordParts.join(" "));

  if (input.naicsCodes && input.naicsCodes.length > 0) {
    params.set("ncode", input.naicsCodes.join(","));
  }
  if (input.department && input.department.trim()) {
    params.set("deptname", input.department.trim());
  }

  try {
    const res = await fetch(`${SAM_OPP_BASE}?${params.toString()}`, {
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: friendlySamError(text, res.status),
        status: res.status,
      };
    }
    const data = JSON.parse(text) as {
      totalRecords?: number;
      opportunitiesData?: SamOpportunity[];
    };
    let ops = (data.opportunitiesData ?? []).filter((o) =>
      input.activeOnly === false ? true : o.active === "Yes",
    );

    // SAM.gov frequently returns the description as a URL pointing to
    // /v1/noticedesc?noticeid=… instead of inline text. Enrich those
    // entries by fetching the actual description so the UI doesn't show
    // a raw URL and downstream relevance filtering has something to
    // work with. Limit concurrency so we don't hammer the upstream.
    if (input.enrichDescriptions !== false) {
      ops = await enrichDescriptions(ops, key);
    }

    // Post-fetch relevance gate. SAM.gov's `q` fuzzy-matches and often
    // returns weakly-related results when only a NAICS is set. If the
    // caller passed a keyword, drop entries whose title + description +
    // agency don't actually contain ALL of the search tokens.
    let totalAfterFilter = data.totalRecords ?? ops.length;
    if (userKeyword) {
      const before = ops.length;
      ops = filterByKeywordRelevance(ops, userKeyword);
      totalAfterFilter = ops.length;
      if (before !== ops.length) {
        // Soft-log; not user-facing here.
        console.info(
          `[samgov] keyword "${userKeyword}" filtered ${before - ops.length} of ${before} results`,
        );
      }
    }

    return {
      ok: true,
      opportunities: ops,
      totalRecords: totalAfterFilter,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compose a Lucene-style AND query from a user keyword. Quoted phrases
 * stay quoted (`"zero trust" deployment` becomes `+"zero trust" +deployment`).
 * Single tokens get a leading `+` so SAM.gov requires them.
 */
function buildAndKeyword(input: string): string {
  // Pull out quoted phrases first.
  const tokens: string[] = [];
  const trimmed = input.trim();
  const quotedRegex = /"([^"]+)"/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = quotedRegex.exec(trimmed)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(...trimmed.slice(lastIndex, match.index).trim().split(/\s+/));
    }
    tokens.push(`"${match[1]}"`);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < trimmed.length) {
    tokens.push(...trimmed.slice(lastIndex).trim().split(/\s+/));
  }

  const cleaned = tokens
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith("+") || t.startsWith("-") ? t : `+${t}`));
  return cleaned.join(" ");
}

/**
 * Resolve description URLs into actual descriptions. Caps concurrency
 * at 4 so large result sets don't fan out into 50 requests at once.
 */
async function enrichDescriptions(
  ops: SamOpportunity[],
  apiKey: string,
): Promise<SamOpportunity[]> {
  const needsFetch = ops
    .map((op, i) => ({ op, i }))
    .filter(({ op }) => isUrl(op.description));

  if (needsFetch.length === 0) return ops;

  const out = ops.slice();
  const queue = needsFetch.slice();
  const concurrency = 4;

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      try {
        const fetched = await fetchNoticeDescription(item.op, apiKey);
        if (fetched) {
          out[item.i] = { ...item.op, description: fetched };
        } else {
          // Couldn't resolve — drop the URL so the UI doesn't show it.
          out[item.i] = { ...item.op, description: "" };
        }
      } catch (err) {
        console.warn("[samgov] noticedesc fetch failed", err);
        out[item.i] = { ...item.op, description: "" };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

function isUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^https?:\/\//i.test(s.trim());
}

async function fetchNoticeDescription(
  op: SamOpportunity,
  apiKey: string,
): Promise<string> {
  // Two paths: the description field IS the URL, or we synthesize one
  // from noticeId. Some payloads only give us the URL.
  const url = op.description?.trim();
  let target = "";
  if (url && isUrl(url)) {
    // Append api_key if not present.
    target = url.includes("api_key=")
      ? url
      : url + (url.includes("?") ? "&" : "?") + "api_key=" + encodeURIComponent(apiKey);
  } else if (op.noticeId) {
    target = `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${encodeURIComponent(op.noticeId)}&api_key=${encodeURIComponent(apiKey)}`;
  } else {
    return "";
  }

  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) return "";
  const body = await res.text();
  // Response shape: { description: "..." } — sometimes plain text.
  try {
    const json = JSON.parse(body) as { description?: string };
    return (json.description ?? "").trim();
  } catch {
    return body.trim();
  }
}

/**
 * Drop results that don't actually contain the user's keyword tokens
 * in title / description / agency. Quoted phrases must appear verbatim;
 * single tokens just need to appear somewhere in the searchable text.
 */
function filterByKeywordRelevance(
  ops: SamOpportunity[],
  keyword: string,
): SamOpportunity[] {
  const tokens = parseKeywordTokens(keyword);
  if (tokens.length === 0) return ops;

  return ops.filter((op) => {
    const haystack = [
      op.title ?? "",
      op.description ?? "",
      op.department ?? "",
      op.subTier ?? "",
      op.office ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return tokens.every((t) => haystack.includes(t.toLowerCase()));
  });
}

function parseKeywordTokens(keyword: string): string[] {
  const tokens: string[] = [];
  const quotedRegex = /"([^"]+)"/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = quotedRegex.exec(keyword)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(...keyword.slice(lastIndex, match.index).trim().split(/\s+/));
    }
    tokens.push(match[1]!);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < keyword.length) {
    tokens.push(...keyword.slice(lastIndex).trim().split(/\s+/));
  }
  return tokens.map((t) => t.trim()).filter((t) => t.length > 1);
}

export type SamEntitySearchResult = {
  ueiSAM: string;
  legalBusinessName: string;
  cageCode: string;
  registrationStatus: string;
  registrationExpirationDate: string;
  physicalAddressCity: string;
  physicalAddressStateOrProvinceCode: string;
  physicalAddressCountryCode: string;
  primaryNaics: string;
  sbaCertifications: string[];
};

export type SamEntitySearchParams = {
  legalBusinessName?: string;
  uei?: string;
  cage?: string;
  naics?: string;
  state?: string;
  setAsides?: string[];
  limit?: number;
};

export async function searchSamGovEntities(
  input: SamEntitySearchParams,
): Promise<
  | { ok: true; entities: SamEntitySearchResult[]; totalRecords: number }
  | { ok: false; error: string; status?: number }
> {
  const key = process.env.SAMGOV_API_KEY;
  if (!key) {
    return { ok: false, error: "SAMGOV_API_KEY not configured on the server." };
  }
  if (
    !input.legalBusinessName &&
    !input.uei &&
    !input.cage &&
    !input.naics
  ) {
    return {
      ok: false,
      error:
        "Provide at least one search term (name, UEI, CAGE, or NAICS).",
    };
  }

  const params = new URLSearchParams({
    api_key: key,
    samRegistered: "Yes",
    registrationStatus: "A",
    // SAM.gov Entity Management API caps `size` at 10 per request and
    // returns HTTP 400 ("Size Cannot Exceed 10 Records") above that.
    // Distinct from the Opportunities API which allows up to 1000.
    size: String(Math.min(input.limit ?? MAX_ENTITY_SEARCH_SIZE, MAX_ENTITY_SEARCH_SIZE)),
    page: "0",
  });
  if (input.legalBusinessName) {
    params.set("legalBusinessName", input.legalBusinessName);
  }
  if (input.uei) params.set("ueiSAM", input.uei);
  if (input.cage) params.set("cageCode", input.cage);
  if (input.naics) params.set("primaryNaics", input.naics);
  if (input.state) params.set("physicalAddressProvinceOrStateCode", input.state);

  try {
    const res = await fetch(`${SAM_BASE}?${params.toString()}`, {
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: friendlySamError(text, res.status),
        status: res.status,
      };
    }
    const data = JSON.parse(text) as {
      totalRecords?: number;
      entityData?: SamRawEntity[];
    };
    const entities: SamEntitySearchResult[] = (data.entityData ?? []).map(
      (raw) => {
        const reg = raw.entityRegistration ?? {};
        const addr = raw.coreData?.physicalAddress ?? {};
        const naics = raw.coreData?.naicsInformation?.primaryNaics ?? "";
        const sbaList = raw.coreData?.businessTypes?.sbaBusinessTypeList ?? [];
        return {
          ueiSAM: reg.ueiSAM ?? "",
          legalBusinessName: reg.legalBusinessName ?? "",
          cageCode: reg.cageCode ?? "",
          registrationStatus: reg.registrationStatus ?? "",
          registrationExpirationDate: reg.registrationExpirationDate ?? "",
          physicalAddressCity: addr.city ?? "",
          physicalAddressStateOrProvinceCode: addr.stateOrProvinceCode ?? "",
          physicalAddressCountryCode: addr.countryCode ?? "USA",
          primaryNaics: naics,
          sbaCertifications: sbaList
            .map((b) => b.sbaBusinessTypeDesc ?? "")
            .filter(Boolean),
        };
      },
    );
    return {
      ok: true,
      entities,
      totalRecords: data.totalRecords ?? entities.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
