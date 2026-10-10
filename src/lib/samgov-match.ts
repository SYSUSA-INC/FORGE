/**
 * BL-STAB-10 — keyword matching for SAM.gov searches (pure; the Import page
 * re-checks rows with it). SAM.gov's public search has no keyword parameter,
 * so FORGE checks the keyword itself, in text it read: a notice whose
 * description wasn't read is "unchecked" — never a match, never a non-match.
 */

/** SAM.gov notice types (its `ptype` codes), the open ones first. */
export const NOTICE_TYPES = [
  { code: "o", label: "Solicitation", open: true },
  { code: "k", label: "Combined Synopsis/Solicitation", open: true },
  { code: "p", label: "Presolicitation", open: true },
  { code: "r", label: "Sources Sought", open: true },
  { code: "s", label: "Special Notice", open: true },
  { code: "a", label: "Award Notice", open: false },
  { code: "u", label: "Justification (J&A)", open: false },
  { code: "i", label: "Intent to Bundle", open: false },
  { code: "g", label: "Sale of Surplus Property", open: false },
] as const;
export type NoticeTypeCode = (typeof NOTICE_TYPES)[number]["code"];
export const OPEN_NOTICE_TYPES: NoticeTypeCode[] = NOTICE_TYPES.filter((t) => t.open).map((t) => t.code);

/** The type code of SAM.gov's `type` text, or null for one FORGE doesn't know. */
export function noticeTypeCode(type: string | null | undefined): NoticeTypeCode | null {
  const t = (type ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("award")) return "a";
  if (t.includes("justification")) return "u";
  if (t.includes("bundl")) return "i";
  if (t.includes("surplus")) return "g";
  if (t.includes("combined")) return "k";
  if (t.includes("presolicitation") || t.includes("pre-solicitation") || t.includes("pre solicitation")) return "p";
  if (t.includes("sources sought")) return "r";
  if (t.includes("special notice")) return "s";
  if (t.includes("solicitation")) return "o";
  return null;
}

/** The requested types, kept to SAM.gov's codes; none (or nothing valid) means the open ones. */
export function parseNoticeTypes(input: unknown): NoticeTypeCode[] {
  const known = new Set<string>(NOTICE_TYPES.map((t) => t.code));
  const picked = Array.isArray(input) ? input.filter((c): c is NoticeTypeCode => typeof c === "string" && known.has(c)) : [];
  return picked.length > 0 ? [...new Set(picked)] : OPEN_NOTICE_TYPES;
}

/** Whether a notice is of a wanted type. A type FORGE doesn't know is kept, not silently dropped. */
export function isWantedType(row: { type?: string | null; baseType?: string | null }, wanted: NoticeTypeCode[]): boolean {
  const code = noticeTypeCode(row.type) ?? noticeTypeCode(row.baseType);
  return code === null || wanted.includes(code);
}

/** terms: all must appear; excluded (`-word`): none may; anyOf (GSA vehicles): one must, when given. Lower-case. */
export type KeywordQuery = { terms: string[]; excluded: string[]; anyOf: string[] };

/** `"zero trust" +cloud -hardware` → terms ["zero trust", "cloud"], excluded ["hardware"]. */
export function parseKeyword(input: string, anyOf: string[] = []): KeywordQuery {
  const terms: string[] = [];
  const excluded: string[] = [];
  const re = /([+-]?)"([^"]+)"|(\S+)/g;
  const text0 = (input ?? "").replace(/[“”„]/g, '"');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text0)) !== null) {
    let sign = m[1] ?? "";
    // A loose word loses stray quotes and trailing commas ("ServiceNow, ITSM"); + and ) stay (OASIS+, 8(a)).
    let text = m[2] ?? (m[3] ?? "").replace(/"/g, "").replace(/[,;:!?]+$/, "");
    if (!m[2] && /^[+-]/.test(text)) {
      sign = text[0]!;
      text = text.slice(1);
    }
    const term = norm(text);
    if (!term) continue;
    (sign === "-" ? excluded : terms).push(term);
  }
  return { terms: [...new Set(terms)], excluded: [...new Set(excluded)], anyOf: [...new Set(anyOf.map(norm).filter(Boolean))] };
}

export function hasKeyword(q: KeywordQuery): boolean {
  return q.terms.length > 0 || q.excluded.length > 0 || q.anyOf.length > 0;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Readable text: tags removed, common entities decoded, whitespace collapsed. */
export function plainText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e: string) => ENTITIES[e] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(s: string): string {
  return plainText(s).toLowerCase();
}

const WORD = /[a-z0-9]/;

/** Where `term` appears in lower-cased `text` as a whole word or phrase, or its plural, else -1. */
export function findTerm(text: string, term: string): number {
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    const before = text[at - 1] ?? " ";
    const startsWord = WORD.test(term[0]!);
    const endsWord = WORD.test(term[term.length - 1]!);
    // A plural counts ("license" finds "licenses"); "ai" still isn't in "maintain".
    const end = at + term.length + (endsWord ? (/^e?s(?![a-z0-9])/.exec(text.slice(at + term.length))?.[0].length ?? 0) : 0);
    const after = text[end] ?? " ";
    if ((!startsWord || !WORD.test(before)) && (!endsWord || !WORD.test(after))) return at;
  }
  return -1;
}

export type DescriptionState = { text: string } | { none: true } | { unread: true };

export type NoticeMatch =
  | { status: "match"; where: "title" | "agency" | "description"; snippet: string }
  | { status: "not_mentioned" }
  | { status: "no_description" }
  | { status: "unchecked" };

const SNIPPET = 180;

function snippetAt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, Math.max(at + length, start + SNIPPET));
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Check one notice. Title and agency are always known; the description
 * only when FORGE read it (`null` = not read yet, same as unread). A
 * match needs every term and one of `anyOf`, and no excluded term — and
 * an excluded term can only be ruled out in text that was read.
 */
export function matchNotice(row: { title: string; agency: string }, q: KeywordQuery, desc: DescriptionState | null): NoticeMatch {
  const fields: { where: "title" | "agency" | "description"; text: string }[] = [
    { where: "title", text: plainText(row.title) },
    { where: "agency", text: plainText(row.agency) },
  ];
  const read = desc !== null && !("unread" in desc);
  if (desc && "text" in desc && desc.text.trim()) fields.push({ where: "description", text: plainText(desc.text) });
  const lower = fields.map((f) => f.text.toLowerCase());
  const locate = (term: string) => {
    for (const [i, t] of lower.entries()) {
      const at = findTerm(t, term);
      if (at !== -1) return { field: fields[i]!, at, length: term.length };
    }
    return null;
  };
  if (q.excluded.some((t) => locate(t))) return { status: "not_mentioned" };
  const hits = q.terms.map(locate);
  const anyHit = q.anyOf.length === 0 ? null : q.anyOf.map(locate).find(Boolean) ?? undefined;
  const found = hits.every(Boolean) && anyHit !== undefined;
  // Excluded terms can hide in an unread description: not decided until it's read.
  if (found && (read || q.excluded.length === 0)) {
    const first = [...hits, anyHit].filter((h): h is NonNullable<typeof h> => !!h);
    const where = first.some((h) => h.field.where === "description") ? "description" : first.some((h) => h.field.where === "agency") ? "agency" : "title";
    const lead = first.find((h) => h.field.where === where) ?? first[0];
    return { status: "match", where, snippet: lead ? snippetAt(lead.field.text, lead.at, lead.length) : fields[0]!.text };
  }
  if (!read) return { status: "unchecked" };
  return desc && "none" in desc ? { status: "no_description" } : { status: "not_mentioned" };
}

/**
 * One row per solicitation number: SAM.gov posts each amendment or award
 * as its own notice. The latest (by posted date) stands for the group; the
 * others are listed by id. Notices without a number are never grouped.
 */
export function collapseBySolicitation<
  T extends { noticeId: string; solicitationNumber: string; postedDate: string; department?: string | null; fullParentPathName?: string | null },
>(rows: T[]): (T & { earlierNoticeIds: string[] })[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const number = (row.solicitationNumber ?? "").replace(/\s+/g, "").toUpperCase();
    // Within one department: "N/A" or "RFI-001" from two agencies are different notices.
    const dept = (row.department || (row.fullParentPathName ?? "").split(".")[0] || "").trim().toUpperCase();
    const key = number ? `n:${dept}|${number}` : `id:${row.noticeId}`;
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const time = (r: T) => Date.parse(r.postedDate) || 0;
  return order.map((key) => {
    const members = groups.get(key)!;
    const latest = members.reduce((a, b) => (time(b) > time(a) || (time(b) === time(a) && b.noticeId > a.noticeId) ? b : a));
    return { ...latest, earlierNoticeIds: members.filter((m) => m !== latest).map((m) => m.noticeId) };
  });
}

/** samTotal: what SAM.gov said it has; received: rows FORGE got (1,000 a request at most); otherTypes: solicitations of unwanted types; folded: earlier notices folded into the latest. */
export type KeywordSearchCounts = {
  samTotal: number;
  received: number;
  otherTypes: number;
  folded: number;
  matched: number;
  notMentioned: number;
  noDescription: number;
  unchecked: number;
};

/** The results line the Import page shows (tested here, so the wording is true). */
export function searchSummary(c: KeywordSearchCounts, i: { keyword: string | null; codes: string[]; days: number }): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  const scope = `${i.codes.length ? `NAICS ${i.codes.join(", ")}` : "all NAICS codes"}, posted in the last ${i.days} days`;
  const extra = [
    c.otherTypes > 0 ? `${plural(c.otherTypes, "notice")} of other types left out` : "",
    c.folded > 0 ? `${plural(c.folded, "earlier notice")} of the same solicitations folded in` : "",
    c.received < c.samTotal ? `FORGE read the first ${c.received.toLocaleString("en-US")} of ${c.samTotal.toLocaleString("en-US")}; narrow the codes or the window to see the rest` : "",
  ].filter(Boolean);
  const tail = extra.length ? ` · ${extra.join(" · ")}` : "";
  if (!i.keyword) return `${plural(c.matched, "notice")} for ${scope}${tail}.`;
  const why = [
    c.notMentioned > 0 ? `${c.notMentioned.toLocaleString("en-US")} don't mention it` : "",
    c.noDescription > 0 ? `${c.noDescription.toLocaleString("en-US")} have no description` : "",
    c.unchecked > 0 ? `${c.unchecked.toLocaleString("en-US")} not checked yet` : "",
  ].filter(Boolean);
  return `${plural(c.matched, "notice")} ${c.matched === 1 ? "mentions" : "mention"} “${i.keyword}” · out of ${plural(c.samTotal, "notice")} SAM.gov has for ${scope}${why.length ? ` (${why.join(", ")})` : ""}${tail}.`;
}

/** A notice's agency: v2's path ("DEPT.SUB-TIER.OFFICE"), else the deprecated department and sub-tier. */
export function noticeAgency(o: { department?: string | null; subTier?: string | null; fullParentPathName?: string | null }): string {
  const legacy = [o.department, o.subTier].filter((s): s is string => !!s && s.trim() !== "").join(" · ");
  if (legacy) return legacy;
  return (o.fullParentPathName ?? "").split(".").map((s) => s.trim()).filter(Boolean).slice(0, 2).join(" · ");
}
