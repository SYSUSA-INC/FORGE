/**
 * BL-STAB-10 — keyword matching for SAM.gov opportunity searches (pure, so
 * the Import page can re-check rows in the browser).
 *
 * SAM.gov's public opportunities search has no keyword parameter (only
 * `title`), so FORGE checks the keyword itself, in text it actually read.
 * A notice is a match only when every term was found in its title,
 * agency or description; one whose description FORGE couldn't read is
 * "unchecked" — never a match, never a non-match.
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

export type KeywordQuery = {
  /** Every one must appear (words or quoted phrases, lower-case). */
  terms: string[];
  /** None may appear (`-word`). */
  excluded: string[];
  /** At least one must appear, when any are given (the GSA vehicle names). */
  anyOf: string[];
};

/** `"zero trust" +cloud -hardware` → terms ["zero trust", "cloud"], excluded ["hardware"]. */
export function parseKeyword(input: string, anyOf: string[] = []): KeywordQuery {
  const terms: string[] = [];
  const excluded: string[] = [];
  const re = /([+-]?)"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input ?? "")) !== null) {
    let sign = m[1] ?? "";
    let text = m[2] ?? m[3] ?? "";
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

/** Where `term` appears in lower-cased `text` as a whole word or phrase ("ai" is not in "maintain"), else -1. */
export function findTerm(text: string, term: string): number {
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    const before = text[at - 1] ?? " ";
    const after = text[at + term.length] ?? " ";
    const startsWord = WORD.test(term[0]!);
    const endsWord = WORD.test(term[term.length - 1]!);
    if ((!startsWord || !WORD.test(before)) && (!endsWord || !WORD.test(after))) return at;
  }
  return -1;
}

/** What FORGE knows of a notice's description. */
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
export function collapseBySolicitation<T extends { noticeId: string; solicitationNumber: string; postedDate: string }>(
  rows: T[],
): (T & { earlierNoticeIds: string[] })[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const number = (row.solicitationNumber ?? "").replace(/\s+/g, "").toUpperCase();
    const key = number ? `n:${number}` : `id:${row.noticeId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }
  const time = (r: T) => Date.parse(r.postedDate) || 0;
  return order.map((key) => {
    const members = groups.get(key)!;
    const latest = members.reduce((a, b) => (time(b) > time(a) || (time(b) === time(a) && b.noticeId > a.noticeId) ? b : a));
    return { ...latest, earlierNoticeIds: members.filter((m) => m !== latest).map((m) => m.noticeId) };
  });
}

export type KeywordSearchCounts = {
  /** What SAM.gov said it has for the request(s). */
  samTotal: number;
  /** Rows FORGE received (SAM.gov returns at most 1,000 per request). */
  received: number;
  /** Rows of other notice types, left out. */
  otherTypes: number;
  /** Earlier notices of the same solicitation, folded into the latest. */
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
