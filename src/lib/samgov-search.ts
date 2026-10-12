import "server-only";
import { noticeStore, type StoredDescription } from "@/lib/sam-notice-store";
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
  plainText,
  type DescriptionState,
  type KeywordQuery,
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
 * — from FORGE's nightly copy of SAM.gov's descriptions for free
 * (BL-STAB-10b), then one SAM.gov request each, newest first, within a
 * per-search budget, for the rest. A notice whose description wasn't read
 * is returned as unchecked, never as a match.
 */

/** Description reads per search: a company's own key often allows few requests a day. */
export const DESCRIPTION_READS = { platform: 30, company: 10 } as const;

/** Results carry this much of a stored description (the import reads the whole of it from the copy). */
const PREVIEW = 400;
const STALE_MS = 48 * 3_600_000;

function preview(text: string): string {
  const t = plainText(text);
  return t.length > PREVIEW ? `${t.slice(0, PREVIEW).trimEnd()}…` : t;
}

function asDescription(s: StoredDescription | undefined): DescriptionState | null {
  if (!s) return null;
  if ("none" in s) return { none: true };
  return s.partial ? { text: s.text, partial: true } : { text: s.text };
}

/** `viaCodes`: which of the searched NAICS codes returned the solicitation (BL-STAB-10b). */
export type FoundNotice = SamOpportunity & { earlierNoticeIds: string[]; viaCodes: string[]; match: NoticeMatch | null };

export type SamSearchResult = {
  ok: true;
  /** Matches (or, with no keyword, every notice). */
  notices: FoundNotice[];
  /** Keyword searches only: notices whose description FORGE hasn't read yet. */
  unchecked: FoundNotice[];
  counts: KeywordSearchCounts;
  /** A code SAM.gov couldn't answer for, while the others did; FORGE's copy of descriptions out of date. */
  warning: string | null;
  /** The day of the newest notice in FORGE's copy (YYYY-MM-DD), when searches read it. */
  copyThrough: string | null;
};

export async function findSamOpportunities(
  cred: SamCredential,
  i: {
    naicsCodes: string[];
    keyword?: string;
    /** At least one of these must appear (GSA vehicle names). */
    anyOf?: string[];
    /** A parsed keyword instead of `keyword` (the scout's saved phrases). */
    query?: KeywordQuery;
    noticeTypes: NoticeTypeCode[];
    postedDaysBack: number;
    /** Only notices whose agency is GSA (checked here; SAM.gov's `deptname` is deprecated). */
    gsaOnly?: boolean;
    limit?: number;
    /** Description reads for this search (default by key; 0 checks titles only). */
    readBudget?: number;
  },
): Promise<SamSearchResult | SamFailure> {
  const q = i.query ?? parseKeyword(i.keyword ?? "", i.anyOf ?? []);
  const keyworded = hasKeyword(q);
  // With no codes, SAM.gov's own title filter narrows the request (FORGE still checks every
  // row): the longest required term, else one request per list item, five at most.
  const longest = [...q.terms].sort((a, b) => b.length - a.length)[0];
  const titles = i.naicsCodes.length ? [] : longest ? [longest] : (q.anyOf[0] ?? []).slice(0, 5);
  const notSent = i.naicsCodes.length || longest ? [] : (q.anyOf[0] ?? []).slice(5);
  const r = await fetchSamOpportunities(cred, {
    naicsCodes: i.naicsCodes,
    titles,
    postedDaysBack: i.postedDaysBack,
    limit: i.limit,
    department: i.gsaOnly ? "General Services Administration" : undefined,
  });
  if (!r.ok) return r;

  const agencyOk = (o: SamOpportunity) => !i.gsaOnly || /general services administration/i.test(`${noticeAgency(o)} ${o.fullParentPathName ?? ""}`);
  const rows = r.rows.filter(agencyOk);
  // Folded before the type filter: a solicitation whose latest notice is its award is awarded, not open.
  const folded = collapseBySolicitation(rows);
  const groups = folded
    .filter((g) => isWantedType(g, i.noticeTypes))
    .sort((a, b) => (Date.parse(b.postedDate) || 0) - (Date.parse(a.postedDate) || 0));
  const byId = new Map(rows.map((o) => [o.noticeId, o]));
  const counts: KeywordSearchCounts = {
    samTotal: r.samTotal,
    received: r.received,
    truncated: r.truncated,
    otherTypes: folded.length - groups.length,
    folded: rows.length - folded.length,
    matched: 0,
    notMentioned: 0,
    noDescription: 0,
    unchecked: 0,
  };
  const budget = i.readBudget ?? DESCRIPTION_READS[cred.source];
  const store = await noticeStore();
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const copyThrough = store.on ? day(store.newestPostedAt) : null;
  const stale = keyworded && store.on && store.fileOf && Date.now() - store.fileOf.getTime() > STALE_MS;
  const warning =
    [
      r.failure ? `SAM.gov didn't answer for ${i.naicsCodes.length ? "NAICS " : "the title search for "}${r.failedCodes.map((c) => q.labels[c] ?? c).join(", ")}: ${r.failure.error}` : "",
      notSent.length ? `With no NAICS codes, SAM.gov is asked about the first 5 keywords only; not searched: ${notSent.map((t) => q.labels[t] ?? t).join(", ")}.` : "",
      stale ? `FORGE's copy of SAM.gov descriptions is from ${day(store.fileOf)}, so newer notices ${budget > 0 ? `are read live, ${budget} per search` : "can't be checked"}.` : "",
    ]
      .filter(Boolean)
      .join(" ") || null;
  const via = (g: { noticeId: string; earlierNoticeIds: string[] }) => [...new Set([g.noticeId, ...g.earlierNoticeIds].flatMap((id) => r.viaCodes[id] ?? []))];

  if (!keyworded) {
    counts.matched = groups.length;
    // A preview of each stored description, so the list reads like SAM.gov's.
    const stored = await store.lookup(groups.map((g) => g.noticeId));
    const withText = groups.map((g) => {
      const d = asDescription(stored.get(g.noticeId.toLowerCase()));
      return { ...g, description: d && "text" in d ? preview(d.text) : g.description, viaCodes: via(g), match: null };
    });
    return { ok: true, notices: withoutLinks(withText), unchecked: [], counts, warning, copyThrough };
  }

  // Title and agency first, for free — of every notice of the solicitation (an
  // amendment's title rarely repeats the keyword); descriptions only where they decide.
  const agency = (o: SamOpportunity) => noticeAgency(o);
  const first = groups.map((g) => {
    const members = [g, ...g.earlierNoticeIds.map((id) => byId.get(id)).filter((o): o is SamOpportunity => !!o)];
    const free = members.map((o) => matchNotice({ title: o.title, agency: agency(o) }, q, null));
    return { g, members, m: free.find((m) => m.status === "match") ?? free[0]! };
  });

  // Then FORGE's copy, for free: a match in any notice's description counts; only the
  // latest notice's whole description can decide that the solicitation doesn't mention it.
  const stored = await store.lookup(first.flatMap((x) => x.members.map((o) => o.noticeId)));
  const storedOf = (id: string) => asDescription(stored.get(id.toLowerCase()));
  const decided = first.map(({ g, members, m }) => {
    const own = storedOf(g.noticeId);
    if (m.status !== "unchecked") return { g, m, desc: own };
    for (const o of members) {
      const d = storedOf(o.noticeId);
      const hit = d ? matchNotice({ title: o.title, agency: agency(o) }, q, d) : null;
      if (hit?.status === "match") return { g, m: hit, desc: own };
    }
    return { g, m: own ? matchNotice({ title: g.title, agency: agency(g) }, q, own) : m, desc: own };
  });

  // Then SAM.gov live for what the copy couldn't decide (posted since the file, only a link
  // there, or cut at 32,000 characters with no hit): one request each, newest first.
  const toRead = decided.filter((x) => x.m.status === "unchecked").map((x) => x.g);
  const read = await readNoticeDescriptions(cred, toRead, budget);

  const notices: FoundNotice[] = [];
  const unchecked: FoundNotice[] = [];
  let uncheckedNew = 0;
  for (const x of decided) {
    const { g } = x;
    let { m } = x;
    const live = m.status === "unchecked" ? read.get(g.noticeId) : undefined;
    if (live && !("unread" in live)) m = matchNotice({ title: g.title, agency: agency(g) }, q, live);
    // Live text in full, as before; stored text as a preview (the import reads the rest).
    const description = live && "text" in live ? live.text : x.desc && "text" in x.desc ? preview(x.desc.text) : g.description;
    const found: FoundNotice = { ...g, description, viaCodes: via(g), match: m };
    if (m.status === "match") notices.push(found);
    else if (m.status === "unchecked") {
      unchecked.push(found);
      if (copyThrough && (g.postedDate ?? "").slice(0, 10) >= copyThrough) uncheckedNew++;
    } else if (m.status === "no_description") counts.noDescription++;
    else counts.notMentioned++;
  }
  counts.matched = notices.length;
  counts.unchecked = unchecked.length;
  counts.uncheckedNew = uncheckedNew;
  return { ok: true, notices: withoutLinks(notices), unchecked: withoutLinks(unchecked), counts, warning, copyThrough };
}
