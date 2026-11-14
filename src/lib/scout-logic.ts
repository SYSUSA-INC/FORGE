/**
 * BL-AIP-7b — the nightly scout, pure parts: the heuristic fit score
 * with its human-readable signals, the grading rule (the human decision
 * grades the model's triage), the track summary, the learning examples
 * the next prompt is shown, and the expiring-award window. Unit-tested.
 */
import { setAsideEligibility, type SocioEconomic } from "@/lib/pwin-model";
import { hasKeyword, matchNotice, matchStored, mentionsExcluded, parseKeyword, plainText, type DescriptionState, type KeywordQuery, type KeywordSearchCounts } from "@/lib/samgov-match";

export type ScoutRecommendation = "pursue" | "watch" | "skip";
export type ScoutDecision = "imported" | "dismissed";
export type ScoutGrade = "correct" | "wrong" | "inconclusive";
export type ScoutSource = "org_naics" | "keyword" | "watchlist_award" | "portal_email";

/** What the page renders — plain JSON, shared by the server lib and the client. */
export type ScoutCandidateView = {
  id: string;
  source: ScoutSource;
  status: "new" | ScoutDecision;
  noticeId: string;
  title: string;
  agency: string;
  office: string;
  solicitationNumber: string;
  noticeType: string;
  setAside: string;
  naicsCode: string;
  incumbent: string;
  postedAt: string | null;
  responseDueAt: string | null;
  daysToDue: number | null;
  placeOfPerformance: string;
  description: string;
  uiLink: string;
  fitScore: number;
  signals: string[];
  /** BL-SCOUT-FIT — how well it matches what the company can do; null = not scored. */
  capabilityBand: "strong" | "related" | "weak" | null;
  capabilityBasis: string;
  recommendation: ScoutRecommendation | null;
  /** BL-AIX Phase 1g-2 — its triage is waiting on a batch. */
  triageQueued: boolean;
  confidence: number | null;
  rationale: string;
  nextActions: string[];
  stubbed: boolean;
  grade: ScoutGrade | null;
  decidedAt: string | null;
  opportunityId: string | null;
  createdAt: string;
};

export type ScoutProfileView = {
  enabled: boolean;
  keywords: string[];
  extraNaics: string[];
  postedDaysBack: number;
  lastRunAt: string | null;
};

export const DEFAULT_SCOUT_PROFILE: ScoutProfileView = {
  enabled: true,
  keywords: [],
  extraNaics: [],
  postedDaysBack: 3,
  lastRunAt: null,
};

export type ScoutRunSummary = {
  runId: string | null;
  searches: number;
  found: number;
  created: number;
  triaged: number;
  skippedGated: number;
  errors: number;
  stubbed: boolean;
  /** BL-SCOUT-FIT — weak-fit finds waiting after this run (kept, counted, out of the default views). */
  weakHidden?: number;
  /** BL-SCOUT-LEARN — the outcomes this run learned from (0 = not acting). */
  learnedFrom?: number;
  note: string;
};

/** BL-SCOUT-LEARN — what the Scout tab says about learning from outcomes. */
export type ScoutLearningView = {
  enabled: boolean;
  mode: "disabled" | "waiting" | "early" | "full";
  cap: number;
  labelled: number;
  positives: number;
  negatives: number;
  line: string;
};

export type ScoutRunView = ScoutRunSummary & {
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
};

const DAY_MS = 24 * 60 * 60_000;

export const SCOUT_RECOMMENDATION_LABELS: Record<ScoutRecommendation, string> = {
  pursue: "Pursue",
  watch: "Watch",
  skip: "Skip",
};

export function isScoutRecommendation(v: unknown): v is ScoutRecommendation {
  return v === "pursue" || v === "watch" || v === "skip";
}

export type FitInput = {
  source: ScoutSource;
  title: string;
  description: string;
  agency: string;
  naicsCode: string;
  setAside: string;
  responseDueAt: Date | null;
};

export type FitContext = {
  primaryNaics: string;
  naicsList: string[];
  socio: SocioEconomic | null;
  keywords: string[];
  /** The keyword search that surfaced this candidate, if any. */
  keyword?: string | null;
  recompete: { outcome: "won" | "lost"; confidence: string; hasLessons: boolean } | null;
  customer: { pursuits: number; won: number; lost: number } | null;
  now: Date;
};

/**
 * BL-SCOUT-QUALITY — how much a keyword is about this notice: in the title
 * or said three times is the work itself; twice, once in a short notice,
 * or in an earlier notice of the solicitation (the search saw it there) is
 * relevant; once in a long description, or only in the agency's name, is a
 * passing mention.
 */
export type KeywordStrength = "strong" | "moderate" | "weak";
export type KeywordWhere = "title" | "text" | "earlier" | "agency";
export type KeywordHit = { term: string; strength: KeywordStrength; inTitle: boolean; mentions: number; where: KeywordWhere };

/** A description longer than this makes a single mention a passing one. */
export const PASSING_MENTION_CHARS = 800;

export type FitResult = { score: number; signals: string[]; keyword: KeywordHit | null };

const STRENGTH_RANK: Record<KeywordStrength, number> = { strong: 3, moderate: 2, weak: 1 };

function countPhrase(haystack: string, phrase: string): number {
  if (!phrase) return 0;
  let n = 0;
  let at = haystack.indexOf(phrase);
  while (at !== -1) {
    n += 1;
    at = haystack.indexOf(phrase, at + phrase.length);
  }
  return n;
}

/**
 * The strongest keyword evidence in the notice's own title and
 * description. `confirmed` is the keyword the search kept the notice for
 * (it may sit in an earlier notice of the solicitation or the agency
 * name): absent from this text, it counts as a passing mention.
 */
export function keywordStrength(title: string, description: string, keywords: string[], confirmed?: string | null, agency = ""): KeywordHit | null {
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const t = flat(title);
  const d = flat(description);
  const a = flat(agency);
  const terms = [...new Set([...(confirmed?.trim() ? [confirmed] : []), ...keywords].map((k) => k.trim()).filter(Boolean))];
  let best: KeywordHit | null = null;
  for (const term of terms) {
    const p = flat(term);
    const inTitle = t.includes(p);
    const mentions = countPhrase(d, p) + (inTitle ? 1 : 0);
    let strength: KeywordStrength | null = null;
    let where: KeywordWhere = inTitle ? "title" : "text";
    if (inTitle || mentions >= 3) strength = "strong";
    else if (mentions === 2) strength = "moderate";
    else if (mentions === 1) strength = d.length > PASSING_MENTION_CHARS ? "weak" : "moderate";
    else if (term === confirmed?.trim()) {
      // The search kept the notice for it, so it is in an earlier notice of
      // this solicitation, or only in the agency's name.
      where = a.includes(p) ? "agency" : "earlier";
      strength = where === "agency" ? "weak" : "moderate";
    }
    if (!strength) continue;
    const hit: KeywordHit = { term, strength, inTitle, mentions, where };
    if (!best || STRENGTH_RANK[strength] > STRENGTH_RANK[best.strength] || (strength === best.strength && mentions > best.mentions)) best = hit;
  }
  return best;
}

/**
 * BL-SCOUT-QUALITY — a find kept for a keyword that is only mentioned in
 * passing, with nothing else that ties it to this company (a recompete, a
 * win at the agency), is not worth a person's time: the scout drops it.
 */
export function passingMentionOnly(fit: FitResult, ctx: { recompete: FitContext["recompete"]; customer: FitContext["customer"] }, source: ScoutSource): boolean {
  if (source !== "keyword") return false;
  if (fit.keyword && fit.keyword.strength !== "weak") return false;
  if (ctx.recompete) return false;
  if (ctx.customer && ctx.customer.won > 0) return false;
  return true;
}

/**
 * BL-SCOUT-QUALITY — the key that makes two SAM.gov notices one
 * solicitation (each amendment is its own notice): the solicitation number
 * with only its letters and digits, upper-cased. Short or generic numbers
 * ("N/A", "RFI-001") never group.
 */
export function solicitationKey(number: string | null | undefined): string | null {
  const k = (number ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return k.length >= 8 ? k : null;
}

/** The recompete radar's verdict, read back from the signals a stored find carries (re-scoring keeps it). */
export function recompeteFromSignals(signals: string[]): FitContext["recompete"] {
  if (signals.includes("Looks like a recompete of a pursuit you won")) return { outcome: "won", confidence: "stored", hasLessons: false };
  if (signals.includes("Looks like a recompete of a pursuit you lost; lessons are on file")) return { outcome: "lost", confidence: "stored", hasLessons: true };
  if (signals.includes("Looks like a recompete of a pursuit you lost")) return { outcome: "lost", confidence: "stored", hasLessons: false };
  return null;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 0..100 heuristic fit, before the model's take. Each rule adds a signal
 * the reader (and the prompt) can see, so the number is never a mystery.
 *
 * BL-SCOUT-QUALITY — it starts at zero and is earned: what is being bought
 * (the keyword in the title or said often) counts most; the company's
 * codes count less, since a NAICS code covers far more work than any one
 * company does; a passing mention of a keyword is worth almost nothing.
 */
export function scoutFit(c: FitInput, ctx: FitContext): FitResult {
  let score = 0;
  const signals: string[] = [];

  const primary = norm(ctx.primaryNaics);
  const list = ctx.naicsList.map(norm).filter(Boolean);
  const naics = norm(c.naicsCode);
  if (naics && primary && naics === primary) {
    score += 25;
    signals.push(`NAICS ${c.naicsCode} is your primary code`);
  } else if (naics && list.includes(naics)) {
    score += 15;
    signals.push(`NAICS ${c.naicsCode} is one of your codes`);
  } else if (naics && (primary || list.length > 0)) {
    score -= 10;
    signals.push(`NAICS ${c.naicsCode} is outside your codes`);
  }

  const eligible = setAsideEligibility(c.setAside, ctx.socio);
  if (eligible === true) {
    score += 10;
    signals.push(`Set-aside you qualify for: ${c.setAside}`);
  } else if (eligible === false) {
    score -= 30;
    signals.push(`Set-aside you do not qualify for: ${c.setAside}`);
  }

  if (ctx.recompete) {
    if (ctx.recompete.outcome === "won") {
      score += 25;
      signals.push("Looks like a recompete of a pursuit you won");
    } else {
      score += ctx.recompete.hasLessons ? 10 : 5;
      signals.push(
        ctx.recompete.hasLessons
          ? "Looks like a recompete of a pursuit you lost; lessons are on file"
          : "Looks like a recompete of a pursuit you lost",
      );
    }
  }

  if (ctx.customer && ctx.customer.pursuits > 0) {
    if (ctx.customer.won > 0) {
      score += 10;
      signals.push(
        `You have won at ${c.agency || "this agency"} before (${ctx.customer.won} of ${ctx.customer.pursuits})`,
      );
    } else if (ctx.customer.lost >= 2) {
      score -= 5;
      signals.push(
        `No win yet at ${c.agency || "this agency"} after ${ctx.customer.pursuits} pursuits`,
      );
    }
  }

  // Line breaks in a description don't split a phrase (keywordStrength flattens them).
  const keyword = keywordStrength(c.title, c.description, ctx.keywords, ctx.keyword, c.agency);
  if (keyword) {
    const term = keyword.term.trim();
    if (keyword.strength === "strong") {
      score += 30;
      signals.push(keyword.inTitle ? `Your keyword ${term} is in the title` : `Your keyword ${term} is mentioned ${keyword.mentions} times`);
    } else if (keyword.strength === "moderate") {
      score += 15;
      signals.push(
        keyword.where === "earlier"
          ? `Your keyword ${term} is in an earlier notice of this solicitation`
          : keyword.mentions === 2
            ? `Your keyword ${term} is mentioned twice`
            : `Your keyword ${term} is mentioned in this short notice`,
      );
    } else {
      score += 3;
      signals.push(keyword.where === "agency" ? `Your keyword ${term} is only in the agency's name` : `Your keyword ${term} is mentioned once, in passing`);
    }
  }

  if (c.source === "watchlist_award") {
    score += 15;
    signals.push("Expiring award on your watchlist");
  }

  if (c.responseDueAt) {
    const days = Math.ceil((c.responseDueAt.getTime() - ctx.now.getTime()) / DAY_MS);
    if (days < 0) {
      score -= 30;
      signals.push("Response date has passed");
    } else if (days < 5) {
      score -= 20;
      signals.push(`Due in ${days} day${days === 1 ? "" : "s"}`);
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), signals, keyword };
}

/**
 * The human decision grades the model's triage: importing confirms a
 * "pursue" and refutes a "skip"; dismissing does the reverse. "Watch" and
 * an untriaged candidate are never right or wrong.
 */
export function gradeTriage(
  recommendation: ScoutRecommendation | null,
  decision: ScoutDecision,
): ScoutGrade {
  if (recommendation === "pursue") return decision === "imported" ? "correct" : "wrong";
  if (recommendation === "skip") return decision === "dismissed" ? "correct" : "wrong";
  return "inconclusive";
}

export type ScoutTrack = {
  /** Decided candidates. */
  n: number;
  correct: number;
  wrong: number;
  inconclusive: number;
  /** correct / (correct + wrong); null until one decisive call exists. */
  accuracy: number | null;
  imported: number;
  dismissed: number;
};

export const EMPTY_SCOUT_TRACK: ScoutTrack = {
  n: 0,
  correct: 0,
  wrong: 0,
  inconclusive: 0,
  accuracy: null,
  imported: 0,
  dismissed: 0,
};

export function summarizeScoutTrack(rows: { status: string; grade: string | null }[]): ScoutTrack {
  const t: ScoutTrack = { ...EMPTY_SCOUT_TRACK };
  for (const r of rows) {
    if (r.status !== "imported" && r.status !== "dismissed") continue;
    t.n += 1;
    if (r.status === "imported") t.imported += 1;
    else t.dismissed += 1;
    if (r.grade === "correct") t.correct += 1;
    else if (r.grade === "wrong") t.wrong += 1;
    else t.inconclusive += 1;
  }
  const decisive = t.correct + t.wrong;
  t.accuracy = decisive === 0 ? null : Math.round((t.correct / decisive) * 1000) / 1000;
  return t;
}

export type LearningExamples = { imported: string[]; dismissed: string[] };

/**
 * What this team did with earlier finds, one line each, newest first —
 * the next night's prompt learns the team's taste from them.
 */
export function learningExamples(
  rows: { title: string; agency: string; status: string; recommendation: string | null }[],
  max = 6,
): LearningExamples {
  const out: LearningExamples = { imported: [], dismissed: [] };
  for (const r of rows) {
    const bucket = r.status === "imported" ? out.imported : r.status === "dismissed" ? out.dismissed : null;
    if (!bucket || bucket.length >= max) continue;
    const said = isScoutRecommendation(r.recommendation) ? ` (scout said ${r.recommendation})` : "";
    bucket.push(`${r.title.trim().slice(0, 120)}${r.agency ? ` — ${r.agency.trim().slice(0, 80)}` : ""}${said}`);
  }
  return out;
}

/**
 * Days until a watchlisted award's period of performance ends, when that
 * is within `withinDays` and not lapsed by more than 30 days; null
 * otherwise (or when the date is missing / unreadable).
 */
export function awardExpiresWithin(
  endDate: string | null | undefined,
  now: Date,
  withinDays: number,
): number | null {
  if (!endDate) return null;
  const end = new Date(endDate).getTime();
  if (Number.isNaN(end)) return null;
  const days = Math.ceil((end - now.getTime()) / DAY_MS);
  if (days > withinDays) return null;
  if (days < -30) return null;
  return days;
}

// ── what a run searches, and what still fits (BL-STAB-10d) ────────────

/**
 * A NAICS code from a saved entry ("541512", "541512 - Computer Systems
 * Design", "2022 NAICS 541512"): its one six-digit number, else its only
 * number of 2–6 digits, else "" (unreadable — never a guess).
 */
export function naicsCodeOf(entry: string | null | undefined): string {
  const text = entry ?? "";
  const six = text.match(/(?<!\d)\d{6}(?!\d)/g) ?? [];
  if (six.length === 1) return six[0]!;
  if (six.length > 1) return "";
  const runs = text.match(/\d+/g) ?? [];
  return runs.length === 1 && runs[0]!.length >= 2 && runs[0]!.length <= 6 ? runs[0]! : "";
}

/**
 * The NAICS codes a run searches: the Scout page's own first, then the
 * organization's primary and listed codes — at most `max` (one SAM.gov
 * request each); `all` is every code, searched or not; `unreadable` the
 * saved entries no code could be read from.
 */
export function scoutCodes(
  i: { extra: string[]; primary: string | null; list: string[] },
  max: number,
): { searched: string[]; all: string[]; unreadable: string[] } {
  const entries = [...i.extra, i.primary ?? "", ...i.list].map((e) => e.trim()).filter(Boolean);
  const all = [...new Set(entries.map(naicsCodeOf).filter(Boolean))];
  return { searched: all.slice(0, max), all, unreadable: [...new Set(entries.filter((e) => !naicsCodeOf(e)))] };
}

/**
 * Every saved keyword as one list: a find mentions at least one, each a
 * phrase. A `-word` excludes it from every find; a `+word` stays part of
 * its phrase (it can't be required of every find when any keyword will
 * do). Parsed one keyword at a time, so all ten count.
 */
export function scoutKeywordQuery(keywords: string[]): KeywordQuery | null {
  const merged: KeywordQuery = { terms: [], anyOf: [], excluded: [], labels: {}, notes: [] };
  const phrases: string[] = [];
  for (const k of keywords) {
    const q = parseKeyword(k.replace(/[,;]/g, " ").replace(/(^|\s)\+(?=\S)/g, "$1"), [], { asList: true });
    for (const p of q.anyOf.flat()) if (!phrases.includes(p)) phrases.push(p);
    for (const e of q.excluded) if (!merged.excluded.includes(e)) merged.excluded.push(e);
    // "“IT” is in almost every notice": said on the page and in the run's note.
    for (const n of q.notes) if (!merged.notes.includes(n)) merged.notes.push(n);
    merged.labels = { ...q.labels, ...merged.labels };
  }
  if (phrases.length) merged.anyOf.push(phrases);
  return hasKeyword(merged) ? merged : null;
}

/** Saved descriptions are cut here: one this long may hold more than was kept. */
export const SCOUT_DESCRIPTION_CHARS = 20_000;

/**
 * Why a waiting find no longer fits the scout's rules — past its due date,
 * outside the codes, or not mentioning a keyword — or null when it still
 * fits or FORGE can't tell yet. A watchlisted award is never judged here.
 * `desc` is the find's description as matching reads it (FORGE's copy of
 * SAM.gov when the find has none of its own), or null if unknown.
 */
export function staleReason(
  c: { source: ScoutSource; naicsCode: string; responseDueAt: Date | null; title: string; agency: string; matchedKeyword?: string },
  rules: { codes: string[]; query: KeywordQuery | null; now: Date },
  desc: DescriptionState | null,
): "past_due" | "other_code" | "no_keyword" | null {
  if (c.source === "watchlist_award") return null;
  if (c.responseDueAt && c.responseDueAt.getTime() < rules.now.getTime()) return "past_due";
  if (rules.codes.length > 0 && !rules.codes.includes(naicsCodeOf(c.naicsCode))) return "other_code";
  const q = rules.query;
  if (!q) return null;
  const row = { title: c.title, agency: c.agency };
  // Kept for a keyword still searched for (perhaps found in an earlier notice of the
  // solicitation, which the saved text doesn't hold): it fits unless an excluded word shows.
  const kept = plainText(c.matchedKeyword).toLowerCase();
  if (kept && (q.terms.includes(kept) || q.anyOf.some((g) => g.includes(kept)))) return mentionsExcluded(row, q, desc) ? "no_keyword" : null;
  const m = desc ? matchStored(row, q, desc) : matchNotice(row, q, null);
  return m.status === "not_mentioned" || m.status === "no_description" ? "no_keyword" : null;
}

// ── BL-SCOUT-REACH ────────────────────────────────────────────────────

/** The share of a plan's monthly AI requests the scout leaves for the rest of FORGE. */
export const SCOUT_AI_RESERVE = 0.2;

/**
 * How many finds the AI may review this run: what was asked, within the
 * month's allowance less the reserve. `limit` 0 is an unlimited plan.
 */
export function scoutTriageAllowance(limit: number, used: number, wanted: number): number {
  if (limit <= 0) return Math.max(0, wanted);
  return Math.max(0, Math.min(wanted, limit - used - Math.ceil(limit * SCOUT_AI_RESERVE)));
}

/**
 * The search, in one sentence, so the run note shows where notices went:
 * what SAM.gov sent, how many are open solicitations, and with keywords
 * as a filter how many mention one. Says when SAM.gov held more than it
 * sends.
 */
export function scoutSearchFunnel(c: KeywordSearchCounts, keyworded: boolean, perCode: number): string {
  const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;
  const open = keyworded ? c.matched + c.notMentioned + c.noDescription + c.unchecked : c.matched;
  const parts = [`SAM.gov sent ${n(c.received, "notice")}: ${n(open, "open solicitation")} once amendments are folded and awards and closed notices left out`];
  if (keyworded) {
    const not = c.notMentioned + c.noDescription;
    parts.push(`, ${c.matched.toLocaleString("en-US")} mention${c.matched === 1 ? "s" : ""} a keyword and ${not.toLocaleString("en-US")} ${not === 1 ? "doesn't" : "don't"}${c.unchecked > 0 ? `, ${c.unchecked.toLocaleString("en-US")} not checked yet` : ""}`);
  }
  let line = `${parts.join("")}.`;
  if (c.truncated) {
    line += ` SAM.gov holds ${n(c.samTotal, "notice")} for this search but sends at most ${perCode.toLocaleString("en-US")} per code: shorten "Posted in the last" so every one is read.`;
  }
  return line;
}

// ── BL-SCOUT-ONEPAGE ──────────────────────────────────────────────────

export type ScoutListFilter = "best" | "recommended" | "unreviewed" | "all" | "skipped" | "weak";

export const SCOUT_LIST_FILTERS: { key: ScoutListFilter; label: string }[] = [
  { key: "best", label: "Best first" },
  { key: "recommended", label: "Recommended" },
  { key: "unreviewed", label: "Not yet reviewed" },
  { key: "all", label: "All" },
  { key: "skipped", label: "Skipped" },
  { key: "weak", label: "Weak fit" },
];

/**
 * BL-SCOUT-FIT — a find that matches nothing the company does and that
 * the AI has not recommended is set aside: out of the default views and
 * the AI's queue, but kept and counted under Weak fit.
 */
export function isWeakFit(c: Pick<ScoutCandidateView, "capabilityBand" | "recommendation">): boolean {
  return c.capabilityBand === "weak" && c.recommendation === null;
}

const CALL_ORDER = (r: ScoutCandidateView["recommendation"]) => (r === "pursue" ? 0 : r === "watch" ? 1 : r === null ? 2 : 3);

/**
 * The finds a filter shows. Recommended, Not yet reviewed, All and Skipped
 * order Pursue, then Watch, then not yet reviewed, then Skip, best fit
 * first in each. Best first (BL-SCOUT-SHOWN) mixes Pursue, Watch, not yet
 * reviewed and Related finds and orders them by fit score alone, which
 * already carries the capability band and what Scout learned. Both All
 * and Best first leave the AI's skips out (kept under Skipped so a person
 * can overrule it) and the weak fits (kept under Weak fit).
 */
export function filterFinds(finds: ScoutCandidateView[], filter: ScoutListFilter): ScoutCandidateView[] {
  const keep = (c: ScoutCandidateView) =>
    filter === "weak"
      ? isWeakFit(c)
      : isWeakFit(c)
        ? false
        : filter === "recommended"
          ? c.recommendation === "pursue" || c.recommendation === "watch"
          : filter === "unreviewed"
            ? c.recommendation === null
            : filter === "skipped"
              ? c.recommendation === "skip"
              : c.recommendation !== "skip";
  const kept = finds.filter(keep);
  if (filter === "best") return kept.sort((a, b) => b.fitScore - a.fitScore);
  return kept.sort((a, b) => CALL_ORDER(a.recommendation) - CALL_ORDER(b.recommendation) || b.fitScore - a.fitScore);
}

/** Fewer recommended finds than this and the list opens on Best first, so a short Recommended list never hides the rest of what fits. */
export const FEW_RECOMMENDED = 10;

/** The filter the list opens on: Recommended when the AI has recommended plenty, else Best first. */
export function defaultFindsFilter(finds: ScoutCandidateView[]): ScoutListFilter {
  const recommended = finds.filter((c) => c.recommendation === "pursue" || c.recommendation === "watch").length;
  return recommended >= FEW_RECOMMENDED ? "recommended" : "best";
}

/**
 * "Found N, shown M": found is every waiting find; shown is what the
 * default views list (not the AI's skips, not the weak fits); the rest is
 * counted by where it went, so the two always add up.
 */
export function scoutFoundShown(found: number, weak: number, skipped: number): { found: number; shown: number; weak: number; skipped: number } {
  const w = Math.max(0, Math.min(weak, found));
  const sk = Math.max(0, Math.min(skipped, found - w));
  return { found, shown: found - w - sk, weak: w, skipped: sk };
}

export type NoticeDisposition = {
  /** Waiting finds removed because they no longer fit the codes and keywords, or went past due. */
  cleared: number;
  /** Notices already past the response date when read. */
  expired: number;
  /** Notices that only mention a keyword in passing (kept out, or removed from the waiting list). */
  passing: number;
  /** Notices that mention an excluded word. */
  excluded: number;
  /** Open notices past the backfill's cap of best-fitting finds. */
  pastCap: number;
  /** Waiting finds that match nothing the company does. */
  weak: number;
  /** Waiting finds the AI said Skip to. */
  skipped: number;
};

/**
 * BL-SCOUT-SHOWN — one run-note line saying where notices went, so a short
 * list is never a mystery. Empty when nothing was set aside.
 */
export function scoutDispositionLine(d: NoticeDisposition): string {
  const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;
  const parts: string[] = [];
  if (d.cleared > 0) parts.push(`${n(d.cleared, "waiting find")} no longer in the codes and keywords or past due`);
  if (d.expired > 0) parts.push(`${d.expired.toLocaleString("en-US")} already past the response date`);
  if (d.passing > 0) parts.push(`${d.passing.toLocaleString("en-US")} mentioning a keyword only in passing`);
  if (d.excluded > 0) parts.push(`${d.excluded.toLocaleString("en-US")} mentioning an excluded word`);
  if (d.pastCap > 0) parts.push(`${d.pastCap.toLocaleString("en-US")} past the ${SCOUT_FOUND_CAP}-find cap`);
  if (d.weak > 0) parts.push(`${d.weak.toLocaleString("en-US")} matching nothing you do (Weak fit)`);
  if (d.skipped > 0) parts.push(`${d.skipped.toLocaleString("en-US")} the AI said Skip to (Skipped)`);
  return parts.length === 0 ? "" : `Where notices went: ${parts.join("; ")}.`;
}

/** The most finds a backfill keeps (best fitting first). */
export const SCOUT_FOUND_CAP = 500;
