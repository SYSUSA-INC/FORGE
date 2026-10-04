/**
 * BL-16 apiAccess — the rules of the read-only public API, kept pure so
 * they are unit-tested: what a token looks like, how it is presented,
 * token names and lifetimes, a token's state, list paging, and the JSON
 * shapes /api/v1 returns. Generating and hashing live server-side in
 * `api-tokens.ts`.
 */

export const API_TOKEN_PREFIX = "forge_";
/** "forge_" + the first six characters — enough to tell tokens apart. */
export const TOKEN_DISPLAY_LENGTH = 12;
export const MAX_ACTIVE_TOKENS = 20;
/** Lifetimes an admin can pick; 0 = never expires. */
export const TOKEN_EXPIRY_DAYS = [30, 90, 365, 0] as const;
export const DEFAULT_TOKEN_EXPIRY_DAYS = 90;
export const TOKEN_NAME_MAX = 60;
/** Per token. */
export const API_RATE_LIMIT = { limit: 120, windowSeconds: 60 } as const;
/** `last_used_at` is written at most this often per token. */
export const LAST_USED_RESOLUTION_MS = 5 * 60_000;
export const API_PAGE_DEFAULT = 50;
export const API_PAGE_MAX = 100;

const DAY_MS = 86_400_000;
/** 32 random bytes, base64url-encoded. */
const TOKEN_RE = /^forge_[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isApiTokenShape(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/** The token from `Authorization: Bearer forge_…`, or null. */
export function tokenFromAuthorization(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  const token = m?.[1] ?? "";
  return isApiTokenShape(token) ? token : null;
}

export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, TOKEN_DISPLAY_LENGTH);
}

export function validateTokenName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (value.length < 2) return { ok: false, error: "Give the token a name, e.g. the system that will use it." };
  if (value.length > TOKEN_NAME_MAX) return { ok: false, error: `Keep the name to ${TOKEN_NAME_MAX} characters.` };
  return { ok: true, value };
}

/** When a token made now with this lifetime expires; null = never. Undefined for a lifetime not on offer. */
export function tokenExpiry(days: unknown, now: Date = new Date()): Date | null | undefined {
  if (!(TOKEN_EXPIRY_DAYS as readonly unknown[]).includes(days)) return undefined;
  return days === 0 ? null : new Date(now.getTime() + (days as number) * DAY_MS);
}

export type TokenState = "active" | "expired" | "revoked";

export function tokenState(t: { expiresAt: Date | null; revokedAt: Date | null }, now: Date = new Date()): TokenState {
  if (t.revokedAt) return "revoked";
  if (t.expiresAt && t.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function shouldTouchLastUsed(lastUsedAt: Date | null, now: Date = new Date()): boolean {
  return !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS;
}

// ── list paging ────────────────────────────────────────────────────────

/** Lists run newest change first; the cursor is the last row's (updatedAt, id). */
export type ListCursor = { updatedAt: Date; id: string };

export type ListParams = {
  limit: number;
  cursor: ListCursor | null;
  updatedSince: Date | null;
  stage: string | null;
};

export function encodeCursor(c: ListCursor): string {
  return Buffer.from(`${c.updatedAt.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): ListCursor | null {
  const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const updatedAt = new Date(iso ?? "");
  if (Number.isNaN(updatedAt.getTime()) || !id || !isUuid(id)) return null;
  return { updatedAt, id };
}

export function parseListParams(
  sp: URLSearchParams,
  stages: readonly string[],
): { ok: true; value: ListParams } | { ok: false; error: string } {
  const rawLimit = sp.get("limit");
  const limit = rawLimit === null ? API_PAGE_DEFAULT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > API_PAGE_MAX) {
    return { ok: false, error: `limit must be a whole number from 1 to ${API_PAGE_MAX}.` };
  }
  const rawCursor = sp.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return { ok: false, error: "cursor is not one this API returned." };
  const rawSince = sp.get("updated_since");
  const updatedSince = rawSince ? new Date(rawSince) : null;
  if (updatedSince && Number.isNaN(updatedSince.getTime())) {
    return { ok: false, error: "updated_since must be an ISO 8601 date-time, e.g. 2026-10-01T00:00:00Z." };
  }
  const stage = sp.get("stage");
  if (stage && !stages.includes(stage)) return { ok: false, error: `stage must be one of: ${stages.join(", ")}.` };
  return { ok: true, value: { limit, cursor, updatedSince, stage: stage || null } };
}

/** Rows were fetched with limit + 1; trim and say where the next page starts. */
export function pageOf<T extends { id: string; updatedAt: Date }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1]!;
  return { items, nextCursor: encodeCursor({ updatedAt: last.updatedAt, id: last.id }) };
}

// ── response shapes ────────────────────────────────────────────────────

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export type OpportunityRow = {
  id: string;
  title: string;
  agency: string;
  office: string;
  stage: string;
  solicitationNumber: string;
  noticeId: string;
  naicsCode: string;
  pscCode: string;
  setAside: string;
  contractType: string;
  placeOfPerformance: string;
  incumbent: string;
  valueLow: string;
  valueHigh: string;
  pWin: number;
  releaseDate: Date | null;
  responseDueDate: Date | null;
  awardDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function apiOpportunity(r: OpportunityRow) {
  return {
    id: r.id,
    title: r.title,
    agency: r.agency,
    office: r.office,
    stage: r.stage,
    solicitationNumber: r.solicitationNumber,
    samNoticeId: r.noticeId,
    naicsCode: r.naicsCode,
    pscCode: r.pscCode,
    setAside: r.setAside,
    contractType: r.contractType,
    placeOfPerformance: r.placeOfPerformance,
    incumbent: r.incumbent,
    valueLow: r.valueLow,
    valueHigh: r.valueHigh,
    pWin: r.pWin,
    releaseDate: iso(r.releaseDate),
    responseDueDate: iso(r.responseDueDate),
    awardDate: iso(r.awardDate),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export type ProposalRow = {
  id: string;
  opportunityId: string;
  title: string;
  stage: string;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function apiProposal(r: ProposalRow) {
  return {
    id: r.id,
    opportunityId: r.opportunityId,
    title: r.title,
    stage: r.stage,
    submittedAt: iso(r.submittedAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export type SectionRow = {
  id: string;
  kind: string;
  title: string;
  ordering: number;
  status: string;
  wordCount: number;
  pageLimit: number | null;
  updatedAt: Date;
};

export function apiSection(r: SectionRow) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    ordering: r.ordering,
    status: r.status,
    wordCount: r.wordCount,
    pageLimit: r.pageLimit,
    updatedAt: iso(r.updatedAt),
  };
}
