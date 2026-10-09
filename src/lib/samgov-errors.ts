/**
 * BL-STAB-7a — SAM.gov failures in plain words. The key gateway answers a
 * bad key as HTML (`<h1>API_KEY_INVALID</h1>`) or `{"error":{"code"}}`;
 * SAM.gov's own errors are `{errorCode, title, detail}`. All three are
 * read, sorted into a class (code first: the gateway sends API_KEY_INVALID
 * as 401 or 403) and worded for the reader, ending with the SAM.gov code
 * and HTTP status; never upstream HTML or a key. Pure, for unit tests.
 */
export type SamErrorClass =
  | "missing_key"
  /** A company key is stored but can't be read on this server, and there is no shared key. */
  | "key_unreadable"
  | "key_invalid"
  | "key_forbidden"
  | "rate_limited"
  | "bad_request"
  | "not_found"
  | "upstream"
  | "timeout"
  | "network"
  | "bad_response"
  | "foreign_host"
  /** A file SAM.gov refused (401/403) on a request that didn't carry FORGE's key: not a key problem. */
  | "restricted";

/** Whose key a call used: the company's own, or FORGE's shared one. */
export type SamKeySource = "company" | "platform";
/** Who reads the message: a company's people, or platform admins (who can fix SAMGOV_API_KEY). */
export type SamAudience = "tenant" | "operator";

export type SamFailure = { ok: false; error: string; cls: SamErrorClass; status?: number };

/** Each SAM.gov call has a deadline (it also covers reading the body). */
export const SAM_TIMEOUTS_MS = {
  entity: 20_000,
  oppSearch: 25_000,
  noticeDesc: 10_000,
  notice: 20_000,
  attachment: 45_000,
  entitySearch: 20_000,
  keyTest: 15_000,
} as const;
export type SamEndpoint = keyof typeof SAM_TIMEOUTS_MS;

/** Wall-clock budget for resolving description links in one search. */
export const DESCRIPTION_BUDGET_MS = 20_000;

const CODE = /^[A-Z][A-Z0-9_]{2,40}$/;
const KEY_INVALID_CODES = new Set(["API_KEY_INVALID", "API_KEY_MISSING", "API_KEY_DISABLED", "API_KEY_UNVERIFIED"]);
const MAX_DETAIL = 200;
const MAX_MESSAGE = 300;

function codeOf(value: unknown): string | null {
  return typeof value === "string" && CODE.test(value.trim()) ? value.trim() : null;
}

/** Plain text: tags and angle brackets removed, whitespace collapsed, capped. */
function plain(text: string, max = MAX_DETAIL): string {
  const t = text
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The error code and detail from any of SAM.gov's three error shapes. */
export function parseSamErrorBody(body: string): { code: string | null; detail: string | null } {
  const text = (body ?? "").trim();
  if (!text) return { code: null, detail: null };
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j && typeof j === "object") {
      const gw = j.error as Record<string, unknown> | undefined;
      if (gw && typeof gw === "object") {
        return { code: codeOf(gw.code), detail: typeof gw.message === "string" ? plain(gw.message) || null : null };
      }
      const detail = [j.detail, j.title, j.message].find((v): v is string => typeof v === "string" && v.trim() !== "");
      return { code: codeOf(j.errorCode) ?? codeOf(j.code), detail: detail ? plain(detail) || null : null };
    }
  } catch {
    // Not JSON: the gateway's HTML page, or something else.
  }
  const h1 = /<h1[^>]*>\s*([^<]*?)\s*<\/h1>/i.exec(text);
  return { code: h1 ? codeOf(h1[1]) : null, detail: null };
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date). */
function retryAfterSeconds(headers: Headers | undefined, now: number): number | null {
  const raw = headers?.get("retry-after")?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - now) / 1000));
}

/** Sort a non-2xx answer into a class (the code first, then the status). */
export function classifySamResponse(
  status: number,
  body: string,
  headers?: Headers,
  now = Date.now(),
): { cls: SamErrorClass; code: string | null; detail: string | null; retryAfterSec: number | null } {
  const { code, detail } = parseSamErrorBody(body);
  const retryAfterSec = retryAfterSeconds(headers, now);
  let cls: SamErrorClass;
  if (code && KEY_INVALID_CODES.has(code)) cls = "key_invalid";
  else if (code === "API_KEY_UNAUTHORIZED") cls = "key_forbidden";
  else if (code === "OVER_RATE_LIMIT") cls = "rate_limited";
  else if (status === 401) cls = "key_invalid";
  else if (status === 403) cls = "key_forbidden";
  else if (status === 429) cls = "rate_limited";
  else if (status === 404) cls = "not_found";
  else if (status >= 400 && status < 500) cls = "bad_request";
  else cls = "upstream";
  return { cls, code, detail, retryAfterSec };
}

/** A fetch that threw: the deadline passed, or the network failed. */
export function classifyFetchError(err: unknown): "timeout" | "network" {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return name === "AbortError" || name === "TimeoutError" ? "timeout" : "network";
}

/** A rejected or over-limit key: further calls with it will fail the same way. */
export function isKeyOrQuotaFailure(cls: SamErrorClass | undefined): boolean {
  return cls === "key_invalid" || cls === "key_forbidden" || cls === "rate_limited";
}

/**
 * Only SAM.gov itself ever receives the key: https, no credentials or
 * port in the URL, and the exact host api.sam.gov or sam.gov.
 */
export function isSamHost(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    (url.hostname === "api.sam.gov" || url.hostname === "sam.gov")
  );
}

/** Remove any `api_key=…` value and the given secrets from text bound for a person or a log. */
export function redactSamSecrets(text: string, secrets: string[] = []): string {
  let out = text.replace(/api_key=[^&\s"'<>]*/gi, "api_key=…");
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("…");
  return out;
}

function suffix(code: string | null | undefined, status: number | undefined): string {
  if (code && status) return ` (SAM.gov ${code}, HTTP ${status})`;
  if (code) return ` (SAM.gov ${code})`;
  if (status) return ` (HTTP ${status})`;
  return "";
}

function retryHint(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "Try again later";
  const minutes = Math.max(1, Math.round(sec / 60));
  return `Try again later (in about ${minutes} minute${minutes === 1 ? "" : "s"})`;
}

/** The sentence a person sees for a SAM.gov failure. */
export function samErrorMessage(i: {
  cls: SamErrorClass;
  source: SamKeySource;
  audience: SamAudience;
  status?: number;
  code?: string | null;
  detail?: string | null;
  retryAfterSec?: number | null;
  timeoutSec?: number;
  endpoint?: SamEndpoint;
}): string {
  const tail = suffix(i.code, i.status);
  const operator = i.audience === "operator";
  const company = i.source === "company";
  let msg: string;
  switch (i.cls) {
    case "missing_key":
      msg = operator
        ? "FORGE's shared SAM.gov key SAMGOV_API_KEY is not set. Add it in Vercel → Settings → Environment Variables and redeploy."
        : "SAM.gov isn't connected for your company. A company admin can add your SAM.gov API key under Settings → Integrations.";
      break;
    case "key_unreadable":
      msg = "Your company's SAM.gov key can't be read on this FORGE server. A company admin can re-enter it under Settings → Integrations.";
      break;
    case "key_invalid":
      msg = operator
        ? `SAM.gov rejected FORGE's shared key SAMGOV_API_KEY. Generate a new key on SAM.gov, set SAMGOV_API_KEY in Vercel → Settings → Environment Variables (Production and staging) and redeploy.${tail}`
        : company
          ? `SAM.gov rejected your company's SAM.gov API key: it is invalid, expired or not yet active. A company admin can generate a new key on SAM.gov and replace it under Settings → Integrations.${tail}`
          : `SAM.gov rejected FORGE's shared SAM.gov key, which your company uses because it hasn't added its own. This has been logged for FORGE support. To keep working now, a company admin can add your company's own key under Settings → Integrations.${tail}`;
      break;
    case "key_forbidden":
      msg = operator
        ? `SAM.gov refused this request for FORGE's shared key SAMGOV_API_KEY: the key isn't allowed to use this SAM.gov service. Check its access on SAM.gov or replace it.${tail}`
        : company
          ? `SAM.gov recognised your company's API key but refused this request: the key isn't allowed to use this SAM.gov service. Check the key's access on SAM.gov, or replace it under Settings → Integrations.${tail}`
          : `SAM.gov refused this request for FORGE's shared SAM.gov key. This has been logged for FORGE support; try again later, or have a company admin add your company's own key under Settings → Integrations.${tail}`;
      break;
    case "rate_limited":
      msg = operator
        ? `SAMGOV_API_KEY has reached SAM.gov's request limit. Every company without its own key and the gold set share it; wait for SAM.gov's daily reset.${tail}`
        : company
          ? `Your company's SAM.gov API key has reached SAM.gov's request limit. ${retryHint(i.retryAfterSec)}; SAM.gov resets the limit daily.${tail}`
          : `FORGE's shared SAM.gov key has reached SAM.gov's request limit. ${retryHint(i.retryAfterSec)}, or have a company admin add your company's own key under Settings → Integrations.${tail}`;
      break;
    case "bad_request":
      msg = i.detail
        ? `SAM.gov didn't accept the request: ${plain(i.detail).replace(/[.\s]+$/, "")}${tail}.`
        : `SAM.gov didn't accept the request${suffix(null, i.status)}. Check the search terms.`;
      break;
    case "not_found":
      msg =
        i.endpoint === "attachment"
          ? `This attachment is no longer on SAM.gov${suffix(null, i.status)}.`
          : `SAM.gov has no such record${suffix(null, i.status)}.`;
      break;
    case "upstream":
      msg = `SAM.gov is having trouble right now${suffix(null, i.status)}. Try again in a few minutes.`;
      break;
    case "timeout":
      msg = i.timeoutSec
        ? `SAM.gov didn't answer within ${i.timeoutSec} seconds. Try again in a few minutes.`
        : "SAM.gov didn't answer in time. Try again in a few minutes.";
      break;
    case "network":
      msg = "FORGE couldn't reach SAM.gov. Try again in a few minutes.";
      break;
    case "bad_response":
      msg = "SAM.gov sent a reply FORGE couldn't read. Try again in a few minutes.";
      break;
    case "foreign_host":
      msg = "Skipped an attachment link that isn't on sam.gov.";
      break;
    case "restricted":
      msg = `SAM.gov doesn't let FORGE download this attachment; it may be a controlled file that needs a SAM.gov sign-in${suffix(null, i.status)}.`;
      break;
  }
  return plain(msg, MAX_MESSAGE);
}
