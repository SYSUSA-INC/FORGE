/**
 * BL-AIP-7b — the nightly scout, pure parts: the heuristic fit score
 * with its human-readable signals, the grading rule (the human decision
 * grades the model's triage), the track summary, the learning examples
 * the next prompt is shown, and the expiring-award window. Unit-tested.
 */
import { setAsideEligibility, type SocioEconomic } from "@/lib/pwin-model";

export type ScoutRecommendation = "pursue" | "watch" | "skip";
export type ScoutDecision = "imported" | "dismissed";
export type ScoutGrade = "correct" | "wrong" | "inconclusive";
export type ScoutSource = "org_naics" | "keyword" | "watchlist_award";

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
  recommendation: ScoutRecommendation | null;
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
  note: string;
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

export type FitResult = { score: number; signals: string[] };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 0..100 heuristic fit, before the model's take. Each rule adds a signal
 * the reader (and the prompt) can see, so the number is never a mystery.
 */
export function scoutFit(c: FitInput, ctx: FitContext): FitResult {
  let score = 35;
  const signals: string[] = [];

  const primary = norm(ctx.primaryNaics);
  const list = ctx.naicsList.map(norm).filter(Boolean);
  const naics = norm(c.naicsCode);
  if (naics && primary && naics === primary) {
    score += 30;
    signals.push(`NAICS ${c.naicsCode} is your primary code`);
  } else if (naics && list.includes(naics)) {
    score += 20;
    signals.push(`NAICS ${c.naicsCode} is one of your codes`);
  } else if (naics && (primary || list.length > 0)) {
    score -= 10;
    signals.push(`NAICS ${c.naicsCode} is outside your codes`);
  }

  const eligible = setAsideEligibility(c.setAside, ctx.socio);
  if (eligible === true) {
    score += 15;
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

  const haystack = `${c.title} ${c.description}`.toLowerCase();
  const hit = ctx.keyword && haystack.includes(norm(ctx.keyword))
    ? ctx.keyword
    : ctx.keywords.find((k) => k.trim() && haystack.includes(norm(k)));
  if (hit) {
    score += 10;
    signals.push(`Matches your keyword: ${hit.trim()}`);
  }

  if (c.source === "watchlist_award") {
    score += 10;
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

  return { score: Math.max(0, Math.min(100, Math.round(score))), signals };
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
