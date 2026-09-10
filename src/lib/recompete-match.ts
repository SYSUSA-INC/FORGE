/**
 * BL-FB-WIN-RECOMPETE — recompete radar (pure).
 *
 * When a solicitation reappears, the team that bid it last time should
 * hear about it before anyone starts from scratch. This module decides
 * whether an incoming item (a solicitation, an opportunity, or a SAM.gov
 * search result) is the same work an org has already pursued to a
 * decision, and says why: same notice or solicitation number, same
 * issuing office, same agency and NAICS, similar scope, or an incumbent
 * who is the competitor that beat us.
 *
 * Scoring is deterministic and the thresholds are exported so the UI can
 * explain them. Scope similarity is cosine over stemmed unigrams and
 * bigrams with GovCon boilerplate removed, so "IT Support Services" and
 * "Janitorial Support Services" do not look alike. No DB, no server-only.
 */
import { agencyMatches } from "@/lib/customer-patterns";
import { normalizeName } from "@/lib/loss-patterns";

/** The incoming item we are checking. */
export type RecompeteTarget = {
  title: string;
  agency: string;
  naicsCode: string;
  solicitationNumber: string;
  noticeId: string;
  /** Description, requirements, PWS text — whatever scope we have. */
  scopeText: string;
  /** Named incumbent on the incoming item, when known. */
  incumbent: string;
};

/** A decided pursuit with everything the radar wants to surface. */
export type RecompetePrior = {
  proposalId: string;
  opportunityId: string;
  title: string;
  agency: string;
  naicsCode: string;
  solicitationNumber: string;
  noticeId: string;
  scopeText: string;
  outcome: "won" | "lost";
  decidedAt: string | null;
  awardedTo: string;
  awardValue: number | null;
  reasons: string[];
  lessonsLearned: string;
  debrief: { strengths: string; weaknesses: string; improvements: string } | null;
  winnerAnalysis: {
    competitorName: string;
    gapsWeHad: string;
    recommendations: string;
  } | null;
};

export type RecompeteSignalKind =
  | "notice"
  | "solicitation_number"
  | "office_stem"
  | "agency"
  | "naics"
  | "naics_family"
  | "scope"
  | "incumbent";

export type RecompeteSignal = {
  kind: RecompeteSignalKind;
  label: string;
  weight: number;
};

export type RecompeteConfidence = "high" | "medium";

export type RecompeteMatch = {
  prior: RecompetePrior;
  /** 0..1 */
  score: number;
  confidence: RecompeteConfidence;
  /** Raw cosine similarity of the scope text, 0..1. */
  scopeSimilarity: number;
  signals: RecompeteSignal[];
};

/** Plain, serialisable summary for client components and list rows. */
export type RecompeteFlag = {
  proposalId: string;
  opportunityId: string;
  title: string;
  outcome: "won" | "lost";
  decidedAt: string | null;
  awardedTo: string;
  awardValue: number | null;
  reasons: string[];
  score: number;
  confidence: RecompeteConfidence;
  signals: string[];
  /** Best single line of "what to do differently", when we have one. */
  lessons: string;
};

export const RECOMPETE_THRESHOLDS = {
  /** Minimum score to flag at all. */
  flag: 0.55,
  /** Score at or above which we call it a likely recompete. */
  high: 0.75,
  /** Scope similarity below this contributes nothing. */
  scopeMin: 0.12,
  /** Scope similarity at or above this earns the full scope weight. */
  scopeFull: 0.45,
  /** Characters of scope text considered per side. */
  maxScopeChars: 6000,
} as const;

export const RECOMPETE_WEIGHTS = {
  agency: 0.25,
  naics: 0.2,
  naicsFamily: 0.1,
  scope: 0.55,
  officeStem: 0.1,
  incumbent: 0.15,
} as const;

export function confidenceLabel(c: RecompeteConfidence): string {
  return c === "high" ? "Likely recompete" : "Possible recompete";
}

// English function words plus GovCon boilerplate that appears in nearly
// every title and description and therefore says nothing about scope.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can",
  "could", "do", "does", "each", "for", "from", "has", "have", "if", "in", "into",
  "is", "may", "must", "no", "not", "of", "on", "or", "other", "our", "per",
  "shall", "should", "so", "such", "than", "that", "the", "their", "then", "there",
  "these", "this", "those", "to", "under", "upon", "was", "we", "were", "which",
  "who", "whom", "will", "with", "within", "without", "would", "your", "all", "any",
  "also", "including", "include", "includes", "provide", "provided", "provides",
  "service", "services", "support", "program", "programs", "project", "projects",
  "requirement", "requirements", "solicitation", "contract", "contracts",
  "contractor", "contractors", "government", "agency", "department", "office",
  "notice", "sources", "sought", "request", "information", "rfp", "rfq", "rfi",
  "proposal", "proposals", "quote", "quotes", "quotation", "federal", "united",
  "states", "task", "order", "orders", "base", "year", "years", "option", "options",
  "period", "performance", "offeror", "offerors", "amendment", "attachment",
  "section", "page", "pages", "date", "dates", "due", "time", "new",
]);

function stem(w: string): string {
  if (w.length > 6 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Stemmed unigrams plus adjacent bigrams, boilerplate removed. */
export function tokenize(text: string): string[] {
  const words = text
    .slice(0, RECOMPETE_THRESHOLDS.maxScopeChars)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(stem);
  const grams = [...words];
  for (let i = 0; i + 1 < words.length; i += 1) grams.push(`${words[i]} ${words[i + 1]}`);
  return grams;
}

type Vec = { tf: Map<string, number>; norm: number };

function vecOf(tokens: string[]): Vec {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let n = 0;
  for (const v of tf.values()) n += v * v;
  return { tf, norm: Math.sqrt(n) };
}

function cosineVec(a: Vec, b: Vec): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const [small, large] = a.tf.size <= b.tf.size ? [a.tf, b.tf] : [b.tf, a.tf];
  let dot = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) dot += v * w;
  }
  return dot === 0 ? 0 : dot / (a.norm * b.norm);
}

export function cosineSimilarity(a: string[], b: string[]): number {
  return cosineVec(vecOf(a), vecOf(b));
}

type Scoped = { title: string; scopeText: string };
type ScopeVecs = { title: Vec; body: Vec | null };

// Tokenising a 6k-character body is the expensive step, and the radar
// compares every open item against every prior, so vectors are memoised
// per object. Callers keep passing the same objects; nothing else changes.
const vecCache = new WeakMap<Scoped, ScopeVecs>();

function vecsFor(x: Scoped): ScopeVecs {
  const hit = vecCache.get(x);
  if (hit) return hit;
  const body = x.scopeText.trim();
  const v: ScopeVecs = {
    title: vecOf(tokenize(x.title)),
    body: body.length < 40 ? null : vecOf(tokenize(body)),
  };
  vecCache.set(x, v);
  return v;
}

/**
 * Title similarity, blended with body similarity when both sides have a
 * real body. A matching title is a strong recompete signal on its own,
 * so the blend never pulls the result below the title score.
 */
export function scopeSimilarity(target: Scoped, prior: Scoped): number {
  const a = vecsFor(target);
  const b = vecsFor(prior);
  const titleSim = cosineVec(a.title, b.title);
  if (!a.body || !b.body) return titleSim;
  const bodySim = cosineVec(a.body, b.body);
  return Math.max(titleSim, 0.5 * titleSim + 0.5 * bodySim);
}

export function normalizeSolicitationNumber(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The issuing-office prefix of a solicitation number ("W912DY" from
 * "W912DY-24-R-0012"). Empty when the number has no separators or the
 * first segment does not look like an office code.
 */
export function officeStem(s: string): string {
  const parts = s.toUpperCase().trim().split(/[^A-Z0-9]+/).filter(Boolean);
  if (parts.length < 2) return "";
  const first = parts[0]!;
  return first.length >= 4 && /[A-Z]/.test(first) && /\d/.test(first) ? first : "";
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Score one prior pursuit against the incoming item. Returns null when
 * the pair does not clear the flag threshold, or when nothing but agency
 * and NAICS line up (that is customer history, not a recompete).
 */
export function scoreRecompete(
  target: RecompeteTarget,
  prior: RecompetePrior,
): RecompeteMatch | null {
  const signals: RecompeteSignal[] = [];
  const W = RECOMPETE_WEIGHTS;
  const T = RECOMPETE_THRESHOLDS;

  const tNotice = target.noticeId.trim();
  const pNotice = prior.noticeId.trim();
  if (tNotice && pNotice && tNotice === pNotice) {
    signals.push({ kind: "notice", label: "Same SAM.gov notice", weight: 1 });
    return {
      prior,
      score: 1,
      confidence: "high",
      scopeSimilarity: round2(scopeSimilarity(target, prior)),
      signals,
    };
  }

  let score = 0;
  let idHit = false;

  const tNum = normalizeSolicitationNumber(target.solicitationNumber);
  const pNum = normalizeSolicitationNumber(prior.solicitationNumber);
  if (tNum && pNum && tNum === pNum) {
    signals.push({
      kind: "solicitation_number",
      label: `Same solicitation number ${prior.solicitationNumber.trim()}`,
      weight: 0.95,
    });
    score += 0.95;
    idHit = true;
  } else {
    const ts = officeStem(target.solicitationNumber);
    const ps = officeStem(prior.solicitationNumber);
    if (ts && ps && ts === ps) {
      signals.push({ kind: "office_stem", label: `Same issuing office (${ts})`, weight: W.officeStem });
      score += W.officeStem;
      idHit = true;
    }
  }

  const agency = agencyMatches(target.agency, prior.agency);
  if (agency) {
    signals.push({ kind: "agency", label: "Same agency", weight: W.agency });
    score += W.agency;
  }

  // Agency + NAICS alone is customer history, not a recompete, and scope
  // similarity is the expensive step, so stop here when neither the
  // agency nor an identifier lines up.
  if (!agency && !idHit) return null;

  const t6 = digits(target.naicsCode);
  const p6 = digits(prior.naicsCode);
  if (t6 && p6) {
    if (t6 === p6) {
      signals.push({ kind: "naics", label: `Same NAICS ${t6}`, weight: W.naics });
      score += W.naics;
    } else if (t6.length >= 4 && t6.slice(0, 4) === p6.slice(0, 4)) {
      signals.push({ kind: "naics_family", label: `Same NAICS family ${t6.slice(0, 4)}`, weight: W.naicsFamily });
      score += W.naicsFamily;
    }
  }

  const sim = scopeSimilarity(target, prior);
  if (!idHit && sim < T.scopeMin) return null;
  const scaled = clamp01((sim - T.scopeMin) / (T.scopeFull - T.scopeMin));
  if (sim >= T.scopeMin) {
    signals.push({
      kind: "scope",
      label: `Scope ${Math.round(sim * 100)}% similar`,
      weight: round2(W.scope * scaled),
    });
  }
  score += W.scope * scaled;

  const tInc = target.incumbent.trim();
  if (
    tInc &&
    prior.outcome === "lost" &&
    prior.awardedTo.trim() &&
    normalizeName(tInc) === normalizeName(prior.awardedTo)
  ) {
    signals.push({
      kind: "incumbent",
      label: `Incumbent ${prior.awardedTo.trim()} is who beat you`,
      weight: W.incumbent,
    });
    score += W.incumbent;
  }

  score = Math.min(1, score);
  if (score < T.flag) return null;

  return {
    prior,
    score: round2(score),
    confidence: score >= T.high ? "high" : "medium",
    scopeSimilarity: round2(sim),
    signals,
  };
}

function hasIdentifierHit(m: RecompeteMatch): number {
  return m.signals.some((s) => s.kind === "notice" || s.kind === "solicitation_number") ? 1 : 0;
}

/**
 * Ranked matches above the flag threshold, strongest first. Ties go to
 * the match with an identifier hit (a shared notice or solicitation
 * number is more certain than a similar title), then to the most recent.
 */
export function findRecompetes(
  target: RecompeteTarget,
  priors: RecompetePrior[],
  limit = 3,
): RecompeteMatch[] {
  const out: RecompeteMatch[] = [];
  for (const p of priors) {
    const m = scoreRecompete(target, p);
    if (m) out.push(m);
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      hasIdentifierHit(b) - hasIdentifierHit(a) ||
      (b.prior.decidedAt ?? "").localeCompare(a.prior.decidedAt ?? ""),
  );
  return out.slice(0, limit);
}

function firstNonEmpty(...xs: (string | undefined | null)[]): string {
  for (const x of xs) {
    const t = (x ?? "").trim();
    if (t) return t;
  }
  return "";
}

/** Serialisable summary for client components and list rows. */
export function summarizeMatch(m: RecompeteMatch, lessonChars = 280): RecompeteFlag {
  const p = m.prior;
  const lessons = firstNonEmpty(
    p.lessonsLearned,
    p.debrief?.improvements,
    p.winnerAnalysis?.recommendations,
    p.outcome === "won" ? p.debrief?.strengths : p.debrief?.weaknesses,
  );
  return {
    proposalId: p.proposalId,
    opportunityId: p.opportunityId,
    title: p.title,
    outcome: p.outcome,
    decidedAt: p.decidedAt,
    awardedTo: p.awardedTo.trim(),
    awardValue: p.awardValue,
    reasons: p.reasons,
    score: m.score,
    confidence: m.confidence,
    signals: m.signals.map((s) => s.label),
    lessons: lessons.length > lessonChars ? `${lessons.slice(0, lessonChars - 1)}…` : lessons,
  };
}
