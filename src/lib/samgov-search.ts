import "server-only";
import { fetchSamOpportunities, readNoticeDescriptions, withoutLinks, type SamOpportunity } from "@/lib/samgov";
import type { SamFailure } from "@/lib/samgov-errors";
import type { SamCredential } from "@/lib/samgov-key";
import {
  collapseBySolicitation,
  hasKeyword,
  isWantedType,
  matchNotice,
  noticeAgency,
  parseKeyword,
  type KeywordSearchCounts,
  type NoticeMatch,
  type NoticeTypeCode,
} from "@/lib/samgov-match";

/**
 * BL-STAB-10 — "find SAM.gov notices for these codes that mention this
 * keyword", done for real. SAM.gov's public search can't filter by
 * keyword, so FORGE asks it for the codes' notices (or, with no codes, for
 * notices with the keyword in the title), keeps the wanted notice types,
 * folds each solicitation's notices into the latest, and checks the
 * keyword itself: in the title and agency for free, then in descriptions
 * — one SAM.gov request each, newest first, within a per-search budget.
 * A notice whose description wasn't read is returned as unchecked, never
 * as a match.
 */

/** Description reads per search: a company's own key often allows few requests a day. */
export const DESCRIPTION_READS = { platform: 30, company: 10 } as const;

export type FoundNotice = SamOpportunity & { earlierNoticeIds: string[]; match: NoticeMatch | null };

export type SamSearchResult = {
  ok: true;
  /** Matches (or, with no keyword, every notice). */
  notices: FoundNotice[];
  /** Keyword searches only: notices whose description FORGE hasn't read yet. */
  unchecked: FoundNotice[];
  counts: KeywordSearchCounts;
  /** A code SAM.gov couldn't answer for, while the others did. */
  warning: string | null;
};

export async function findSamOpportunities(
  cred: SamCredential,
  i: {
    naicsCodes: string[];
    keyword?: string;
    /** At least one of these must appear (GSA vehicle names). */
    anyOf?: string[];
    noticeTypes: NoticeTypeCode[];
    postedDaysBack: number;
    /** Only notices whose agency is GSA (checked here; SAM.gov's `deptname` is deprecated). */
    gsaOnly?: boolean;
    limit?: number;
    /** Description reads for this search (default by key; 0 checks titles only). */
    readBudget?: number;
  },
): Promise<SamSearchResult | SamFailure> {
  const q = parseKeyword(i.keyword ?? "", i.anyOf ?? []);
  const keyworded = hasKeyword(q);
  // With no codes, SAM.gov's own title filter narrows the request; FORGE still checks every row.
  const titleTerm = i.naicsCodes.length === 0 ? [...q.terms].sort((a, b) => b.length - a.length)[0] : undefined;
  const r = await fetchSamOpportunities(cred, {
    naicsCodes: i.naicsCodes,
    title: titleTerm,
    postedDaysBack: i.postedDaysBack,
    limit: i.limit,
    department: i.gsaOnly ? "General Services Administration" : undefined,
  });
  if (!r.ok) return r;

  const agencyOk = (o: SamOpportunity) => !i.gsaOnly || /general services administration/i.test(`${noticeAgency(o)} ${o.fullParentPathName ?? ""}`);
  const wanted = r.rows.filter((o) => isWantedType(o, i.noticeTypes) && agencyOk(o));
  const groups = collapseBySolicitation(wanted);
  const counts: KeywordSearchCounts = {
    samTotal: r.samTotal,
    received: r.received,
    otherTypes: r.rows.length - wanted.length,
    folded: wanted.length - groups.length,
    matched: 0,
    notMentioned: 0,
    noDescription: 0,
    unchecked: 0,
  };
  const warning = r.failure ? `SAM.gov didn't answer for NAICS ${r.failedCodes.join(", ")}: ${r.failure.error}` : null;

  if (!keyworded) {
    counts.matched = groups.length;
    return { ok: true, notices: withoutLinks(groups.map((g) => ({ ...g, match: null }))), unchecked: [], counts, warning };
  }

  // Title and agency first (free); descriptions only where they decide, newest first.
  const agency = (o: SamOpportunity) => noticeAgency(o);
  const first = groups.map((g) => ({ g, m: matchNotice({ title: g.title, agency: agency(g) }, q, null) }));
  const toRead = first
    .filter((x) => x.m.status === "unchecked")
    .map((x) => x.g)
    .sort((a, b) => (Date.parse(b.postedDate) || 0) - (Date.parse(a.postedDate) || 0));
  const budget = i.readBudget ?? DESCRIPTION_READS[cred.source];
  // Inline descriptions are already read; links cost one request each, up to the budget.
  const read = await readNoticeDescriptions(cred, toRead, budget);

  const notices: FoundNotice[] = [];
  const unchecked: FoundNotice[] = [];
  for (const { g, m: titleMatch } of first) {
    const desc = read.get(g.noticeId) ?? null;
    const m = titleMatch.status === "unchecked" ? matchNotice({ title: g.title, agency: agency(g) }, q, desc) : titleMatch;
    const description = desc && "text" in desc ? desc.text : g.description;
    const found: FoundNotice = { ...g, description, match: m };
    if (m.status === "match") notices.push(found);
    else if (m.status === "unchecked") unchecked.push(found);
    else if (m.status === "no_description") counts.noDescription++;
    else counts.notMentioned++;
  }
  counts.matched = notices.length;
  counts.unchecked = unchecked.length;
  return { ok: true, notices: withoutLinks(notices), unchecked: withoutLinks(unchecked), counts, warning };
}
