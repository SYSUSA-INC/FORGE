import "server-only";
import { log } from "@/lib/log";
import {
  DESCRIPTION_BUDGET_MS,
  SAM_TIMEOUTS_MS,
  classifyFetchError,
  classifySamResponse,
  isKeyOrQuotaFailure,
  isSamHost,
  redactSamSecrets,
  samErrorMessage,
  type SamEndpoint,
  type SamErrorClass,
  type SamFailure,
} from "@/lib/samgov-errors";
import type { SamCredential, SamKeyOutcome } from "@/lib/samgov-key";

/** BL-STAB-7d — the answers that say something about the key itself. */
const KEY_OUTCOMES: Partial<Record<SamErrorClass, SamKeyOutcome>> = { key_invalid: "invalid", key_forbidden: "forbidden", rate_limited: "rate_limited" };

const SAM_BASE = "https://api.sam.gov/entity-information/v4/entities";

// ─────────────────────────────────────────────────────────────────────
// BL-STAB-7a — the one way FORGE talks to SAM.gov
// ─────────────────────────────────────────────────────────────────────

/** A failure worded for whoever will read it; logged without the URL (it carries the key). */
function samFailure(
  cred: SamCredential,
  endpoint: SamEndpoint,
  f: { cls: SamErrorClass; status?: number; code?: string | null; detail?: string | null; retryAfterSec?: number | null },
): SamFailure {
  const detail = f.detail ? redactSamSecrets(f.detail, [cred.revealForSamRequest()]) : null;
  const error = samErrorMessage({
    ...f,
    detail,
    source: cred.source,
    audience: cred.audience,
    endpoint,
    timeoutSec: Math.round(SAM_TIMEOUTS_MS[endpoint] / 1000),
  });
  log.warn("[samgov]", "request failed", { endpoint, status: f.status, cls: f.cls, code: f.code ?? null, source: cred.source });
  if (cred.source === "platform" && (f.cls === "key_invalid" || f.cls === "key_forbidden")) {
    reportSharedKeyRejected(endpoint, f.status, f.code ?? null);
  }
  return { ok: false, error, cls: f.cls, status: f.status };
}

let sharedKeyReportedAt = 0;
/** A dead shared key reaches /admin/errors, at most every ten minutes per instance. */
function reportSharedKeyRejected(endpoint: SamEndpoint, status: number | undefined, code: string | null) {
  const now = Date.now();
  if (now - sharedKeyReportedAt < 10 * 60_000) return;
  sharedKeyReportedAt = now;
  log.error("[samgov]", "shared key rejected", {
    endpoint,
    error: new Error(`SAM.gov rejected FORGE's shared key SAMGOV_API_KEY (HTTP ${status ?? "?"}${code ? ` ${code}` : ""}) on ${endpoint}`),
  });
}

/**
 * Every SAM.gov request goes through here: the key only on a request to
 * SAM.gov itself (other hosts are not fetched), a deadline that covers the
 * body too, and failures classified and worded, never raw upstream text or
 * a thrown message (which can carry the URL and key). `keepLinkKey` keeps
 * the `api_key=null` SAM.gov puts on its public attachment links.
 */
async function samGet(
  cred: SamCredential,
  url: URL,
  call: { endpoint: SamEndpoint; accept?: "application/json"; keepLinkKey?: boolean },
): Promise<{ ok: true; res: Response } | SamFailure> {
  if (!isSamHost(url)) {
    log.warn("[samgov]", "skipped a link that is not on sam.gov", { endpoint: call.endpoint, host: url.hostname });
    return { ok: false, cls: "foreign_host", error: samErrorMessage({ cls: "foreign_host", source: cred.source, audience: cred.audience }) };
  }
  const keySent = !(call.keepLinkKey && url.searchParams.has("api_key"));
  if (keySent) url.searchParams.set("api_key", cred.revealForSamRequest());
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: timeoutSignal(SAM_TIMEOUTS_MS[call.endpoint]),
      headers: call.accept ? { accept: call.accept } : undefined,
    });
  } catch (err) {
    return samFailure(cred, call.endpoint, { cls: classifyFetchError(err) });
  }
  if (res.ok) {
    // BL-STAB-7d — a company key that works is recorded as such.
    if (keySent) await cred.reportOutcome("ok", call.endpoint);
    return { ok: true, res };
  }
  let body = "";
  try {
    // Redacted before it is cut or parsed, so no part of the key survives a trim.
    body = redactSamSecrets(await res.text(), [cred.revealForSamRequest()]).slice(0, 4000);
  } catch {
    // The body is only read to classify the failure.
  }
  const c = classifySamResponse(res.status, body, res.headers);
  // A 401/403 is about FORGE's key only if the key was on the request and
  // SAM.gov itself answered (not a storage host it redirected to).
  const notOurKey = (!keySent || res.redirected) && (c.cls === "key_invalid" || c.cls === "key_forbidden");
  const outcome = notOurKey || !keySent ? null : KEY_OUTCOMES[c.cls];
  if (outcome) await cred.reportOutcome(outcome, call.endpoint);
  return samFailure(cred, call.endpoint, { status: res.status, ...c, cls: notOurKey ? "restricted" : c.cls });
}

/** A SAM.gov JSON endpoint: a reply that isn't JSON is a failure, not a thrown SyntaxError. */
async function samGetJson<T>(cred: SamCredential, url: URL, endpoint: SamEndpoint): Promise<{ ok: true; data: T } | SamFailure> {
  const r = await samGet(cred, url, { endpoint, accept: "application/json" });
  if (!r.ok) return r;
  let text: string;
  try {
    text = await r.res.text();
  } catch (err) {
    return samFailure(cred, endpoint, { cls: classifyFetchError(err) });
  }
  try {
    const data = JSON.parse(text) as T;
    if (data && typeof data === "object") return { ok: true, data };
  } catch {
    // fall through
  }
  return samFailure(cred, endpoint, { cls: "bad_response", status: r.res.status });
}

/**
 * BL-STAB-7c — a SAM.gov reply as text, for callers that read it
 * themselves (the 8(a) registry, the health probe). Same guarantees as
 * every other SAM.gov call: the key only to SAM.gov, a deadline, and a
 * worded failure.
 */
export async function samGetText(cred: SamCredential, url: URL, endpoint: SamEndpoint): Promise<{ ok: true; text: string; status: number } | SamFailure> {
  const r = await samGet(cred, url, { endpoint, accept: "application/json" });
  if (!r.ok) return r;
  try {
    return { ok: true, text: await r.res.text(), status: r.res.status };
  } catch (err) {
    return samFailure(cred, endpoint, { cls: classifyFetchError(err) });
  }
}

function samUrl(base: string, params: Record<string, string>): URL {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

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
  cred: SamCredential,
  uei: string,
): Promise<{ ok: true; profile: NormalizedSamEntity } | SamFailure> {
  if (!uei) return { ok: false, cls: "bad_request", error: "Provide a UEI." };
  const url = samUrl(SAM_BASE, { samRegistered: "Yes", page: "0", size: "1", ueiSAM: uei });
  const r = await samGetJson<{ totalRecords?: number; entityData?: SamRawEntity[] }>(cred, url, "entity");
  if (!r.ok) return r;
  const first = Array.isArray(r.data.entityData) ? r.data.entityData[0] : undefined;
  if (!first) {
    return { ok: false, cls: "not_found", error: "No matching registered entity found in SAM.gov." };
  }
  return { ok: true, profile: normalizeSamEntity(first) };
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
  /** BL-FB-SOL-QA — attachment download URLs, when the notice has any. */
  resourceLinks?: string[] | null;
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

export async function searchSamGovOpportunities(
  cred: SamCredential,
  input: SamOpportunitySearchParams,
): Promise<{ ok: true; opportunities: SamOpportunity[]; totalRecords: number } | SamFailure> {
  const postedTo = new Date();
  const postedFrom = new Date();
  postedFrom.setDate(postedFrom.getDate() - (input.postedDaysBack ?? 30));

  const params = new URLSearchParams({
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

  const url = new URL(SAM_OPP_BASE);
  url.search = params.toString();
  try {
    const r = await samGetJson<{ totalRecords?: number; opportunitiesData?: SamOpportunity[] }>(cred, url, "oppSearch");
    if (!r.ok) return r;
    const data = r.data;
    let ops = (data.opportunitiesData ?? []).filter((o) =>
      input.activeOnly === false ? true : o.active === "Yes",
    );

    // SAM.gov frequently returns the description as a URL pointing to
    // /v1/noticedesc?noticeid=… instead of inline text. Enrich those
    // entries by fetching the actual description so the UI doesn't show
    // a raw URL and downstream relevance filtering has something to
    // work with. Limit concurrency so we don't hammer the upstream.
    if (input.enrichDescriptions !== false) {
      ops = await enrichDescriptions(ops, cred);
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
        log.info("[samgov]", "keyword filtered results", {
          userKeyword,
          before,
          after: ops.length,
        });
      }
    }

    return {
      ok: true,
      opportunities: withoutLinks(ops),
      totalRecords: totalAfterFilter,
    };
  } catch {
    // Data SAM.gov shaped unexpectedly: never a thrown message to the user.
    return samFailure(cred, "oppSearch", { cls: "bad_response" });
  }
}

/**
 * BL-STAB-7b — one fixed search (the opportunity search, one result from
 * the last day) that shows whether SAM.gov accepts a key, before it is saved.
 */
export async function testSamKey(cred: SamCredential): Promise<{ ok: true } | SamFailure> {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const r = await samGetJson<unknown>(cred, samUrl(SAM_OPP_BASE, { limit: "1", postedFrom: mmddyyyy(yesterday), postedTo: mmddyyyy(today) }), "keyTest");
  return r.ok ? { ok: true } : r;
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
 * Resolve description URLs into actual descriptions, four at a time.
 * BL-STAB-7a — a rejected or over-limit key stops new lookups (the same
 * key would fail every one), and so does a 20-second budget for the
 * whole set. A description that could not be resolved keeps its URL so
 * the keyword filter can tell it apart; callers blank it (`withoutLinks`)
 * so the UI never shows one.
 */
async function enrichDescriptions(ops: SamOpportunity[], cred: SamCredential): Promise<SamOpportunity[]> {
  const queue = ops.map((op, i) => ({ op, i })).filter(({ op }) => isUrl(op.description));
  // BL-STAB-7b — a company's own key has its own (often small) daily allowance.
  if (cred.source === "company") queue.splice(COMPANY_DESCRIPTION_LOOKUPS);
  if (queue.length === 0) return ops;

  const out = ops.slice();
  const deadline = Date.now() + DESCRIPTION_BUDGET_MS;
  let stopped = false;

  async function worker(): Promise<void> {
    while (!stopped && Date.now() < deadline) {
      const item = queue.shift();
      if (!item) return;
      const r = await fetchNoticeDescription(item.op, cred);
      if (r.ok) out[item.i] = { ...item.op, description: r.text };
      else if (isKeyOrQuotaFailure(r.cls)) stopped = true;
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
  return out;
}

/** Description lookups per search on a company's own key; the rest stay unchecked. */
const COMPANY_DESCRIPTION_LOOKUPS = 25;

/** A description still holding a link (never resolved) is blanked for display. */
function withoutLinks(ops: SamOpportunity[]): SamOpportunity[] {
  return ops.map((op) => (isUrl(op.description) ? { ...op, description: "" } : op));
}

function isUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^https?:\/\//i.test(s.trim());
}

/** The description behind a SAM.gov description link (JSON `{description}` or plain text). */
async function fetchNoticeDescription(op: SamOpportunity, cred: SamCredential): Promise<{ ok: true; text: string } | SamFailure> {
  let url: URL;
  try {
    url = new URL(op.description.trim());
  } catch {
    return { ok: true, text: "" };
  }
  const r = await samGet(cred, url, { endpoint: "noticeDesc" });
  if (!r.ok) return r;
  let body: string;
  try {
    body = await r.res.text();
  } catch (err) {
    return samFailure(cred, "noticeDesc", { cls: classifyFetchError(err) });
  }
  try {
    const json = JSON.parse(body) as { description?: string };
    return { ok: true, text: (json.description ?? "").trim() };
  } catch {
    return { ok: true, text: body.trim() };
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
    // BL-STAB-7a — a description FORGE couldn't fetch can't be checked;
    // SAM.gov's own search matched the row, so it stays.
    if (isUrl(op.description)) return true;
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

// ─────────────────────────────────────────────────────────────────────
// BL-FB-SOL-QA — one notice and its attachments
// ─────────────────────────────────────────────────────────────────────

/** Abort after `ms` so a hung SAM.gov call cannot stall a request or a cron tick. */
function timeoutSignal(ms: number): AbortSignal {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  if (typeof t === "object" && t && "unref" in t) (t as { unref(): void }).unref();
  return ac.signal;
}

export type SamNotice = {
  noticeId: string;
  title: string;
  solicitationNumber: string;
  postedDate: string;
  description: string;
  uiLink: string;
  resourceLinks: string[];
};

/** One notice by id: its posted date, description and attachment links. */
export async function fetchSamNotice(
  cred: SamCredential,
  noticeId: string,
): Promise<{ ok: true; notice: SamNotice } | (SamFailure & { noSuchNotice?: true })> {
  const id = noticeId.trim();
  if (!id) return { ok: false, cls: "bad_request", error: "Provide a notice ID." };
  // The search API requires a posted-date window of a year at most.
  const postedTo = new Date();
  const postedFrom = new Date(postedTo.getTime() - 364 * 86_400_000);
  const url = samUrl(SAM_OPP_BASE, { noticeid: id, limit: "1", postedFrom: mmddyyyy(postedFrom), postedTo: mmddyyyy(postedTo) });
  try {
    const r = await samGetJson<{ opportunitiesData?: SamOpportunity[] }>(cred, url, "notice");
    if (!r.ok) return r;
    const op = r.data.opportunitiesData?.[0];
    // SAM.gov answered and has no such notice: the one "not found" a caller may count as checked.
    if (!op) return { ok: false, cls: "not_found", noSuchNotice: true, error: "SAM.gov has no notice with that ID posted in the last year." };
    const [enriched] = await enrichDescriptions([op], cred);
    return {
      ok: true,
      notice: {
        noticeId: op.noticeId,
        title: op.title ?? "",
        solicitationNumber: op.solicitationNumber ?? "",
        postedDate: op.postedDate ?? "",
        description: enriched && !isUrl(enriched.description) ? enriched.description : "",
        uiLink: op.uiLink ?? "",
        resourceLinks: (op.resourceLinks ?? []).filter((l): l is string => typeof l === "string" && isUrl(l)),
      },
    };
  } catch {
    // Data SAM.gov shaped unexpectedly: never a thrown message to the user.
    return samFailure(cred, "notice", { cls: "bad_response" });
  }
}

export type SamDownloadFailure = {
  ok: false;
  error: string;
  cls?: SamErrorClass;
  /** Retrying cannot help (a link off sam.gov, a file SAM.gov no longer has, a file over the cap). */
  permanent: boolean;
};

/**
 * Download one notice attachment, bounded; the file name comes from the
 * response headers. Only links on sam.gov are fetched (see samGet).
 */
export async function downloadSamResource(
  cred: SamCredential,
  link: string,
  maxBytes: number,
): Promise<{ ok: true; fileName: string; contentType: string; bytes: Uint8Array } | SamDownloadFailure> {
  const foreign = (): SamDownloadFailure => ({
    ok: false,
    cls: "foreign_host",
    permanent: true,
    error: samErrorMessage({ cls: "foreign_host", source: cred.source, audience: cred.audience }),
  });
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return foreign();
  }
  const r = await samGet(cred, url, { endpoint: "attachment", keepLinkKey: true });
  if (!r.ok) return { ...r, permanent: r.cls === "foreign_host" || r.cls === "not_found" || r.cls === "restricted" };
  const res = r.res;
  const tooBig: SamDownloadFailure = { ok: false, permanent: true, error: `Attachment is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  if (Number(res.headers.get("content-length") ?? "0") > maxBytes) return tooBig;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return { ...samFailure(cred, "attachment", { cls: classifyFetchError(err) }), permanent: false };
  }
  if (bytes.length > maxBytes) return tooBig;
  return {
    ok: true,
    fileName: fileNameFromHeaders(res.headers, link),
    contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim(),
    bytes,
  };
}

/** Content-Disposition file name (RFC 5987 form first), else the URL's last path segment. */
export function fileNameFromHeaders(headers: Headers, url: string): string {
  const cd = headers.get("content-disposition") ?? "";
  const star = /filename\*\s*=\s*(?:utf-8)?''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, ""));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  if (plain) return plain[1]!.trim();
  const path = url.split("?")[0]!.split("/").filter(Boolean);
  const last = path[path.length - 1] ?? "attachment";
  return last === "download" ? (path[path.length - 2] ?? "attachment") : last;
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
  cred: SamCredential,
  input: SamEntitySearchParams,
): Promise<{ ok: true; entities: SamEntitySearchResult[]; totalRecords: number } | SamFailure> {
  if (
    !input.legalBusinessName &&
    !input.uei &&
    !input.cage &&
    !input.naics
  ) {
    return {
      ok: false,
      cls: "bad_request",
      error:
        "Provide at least one search term (name, UEI, CAGE, or NAICS).",
    };
  }

  const params = new URLSearchParams({
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

  const url = new URL(SAM_BASE);
  url.search = params.toString();
  try {
    const r = await samGetJson<{ totalRecords?: number; entityData?: SamRawEntity[] }>(cred, url, "entitySearch");
    if (!r.ok) return r;
    const data = r.data;
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
  } catch {
    // Data SAM.gov shaped unexpectedly: never a thrown message to the user.
    return samFailure(cred, "entitySearch", { cls: "bad_response" });
  }
}
