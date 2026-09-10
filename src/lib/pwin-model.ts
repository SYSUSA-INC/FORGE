/**
 * BL-FB-X-PWIN-MODEL — probability-of-win scorer (pure).
 *
 * Replaces the hand-set PWin slider's guess with an explainable estimate
 * built from signals FORGE already holds, calibrated against the org's
 * own decided outcomes once there are enough of them, and graded over
 * time with a Brier score so the model is honestly scored rather than
 * trusted.
 *
 * Shape: additive log-odds. Start from the org's base win rate (blended
 * toward an industry default while the org has little history), add a
 * bounded contribution per signal, apply a per-org calibration shift
 * when ≥ CALIBRATION_MIN_N decided outcomes exist, squash to a
 * probability. Every contribution is returned as a factor with a label,
 * so the UI can show *why* the number is what it is.
 *
 * v1 weights are heuristic and documented inline. They are the starting
 * point the calibration shift corrects at the org level; a fitted model
 * replaces them once the outcome corpus is large enough to train on.
 * No DB, no server-only: the server lib assembles features and calls in.
 */

export const PWIN_MODEL_VERSION = "v1";

/** Industry-typical PWin for a competitive federal bid, used until an org has history. */
export const DEFAULT_BASE_RATE = 0.3;
/** How many decided outcomes it takes for org history to outweigh the default. */
export const PRIOR_PSEUDO_COUNT = 5;
/** Decided outcomes required before a per-org calibration shift is fitted. */
export const CALIBRATION_MIN_N = 10;
/** Minimum decided outcomes for an agency / NAICS track record to count. */
export const HISTORY_MIN_N = 3;

export type SocioEconomic = {
  sba8a: boolean;
  smallBusiness: boolean;
  sdb: boolean;
  wosb: boolean;
  sdvosb: boolean;
  hubzone: boolean;
};

/** Bid/no-bid evaluation dimensions, 0–100 each (0 = unset). */
export type PwinEvaluation = {
  strategicFit: number;
  customerRelationship: number;
  competitivePosture: number;
  resourceAvailability: number;
  financialAttractiveness: number;
};

export type PwinHistory = { won: number; lost: number };

export type PwinReadiness = {
  scanScore: "strong" | "needs_work" | "critical" | null;
  complianceRatio: number | null;
  complianceTotal: number;
};

export type PwinFeatures = {
  evaluation: PwinEvaluation | null;
  weAreIncumbent: boolean;
  competitorIncumbent: boolean;
  incumbentNamed: boolean;
  competitorCount: number;
  /** null = no set-aside, or wording we do not recognise. */
  setAsideEligible: boolean | null;
  /** null = org has no NAICS list to compare against. */
  naicsInOrgList: boolean | null;
  agencyHistory: PwinHistory | null;
  naicsHistory: PwinHistory | null;
  readiness: PwinReadiness | null;
};

export type PwinPrior = { baseRate: number; won: number; lost: number; n: number };

export type PwinFactor = {
  key: string;
  label: string;
  /** Contribution in log-odds; positive helps. */
  logOdds: number;
  detail: string;
};

export type PwinConfidence = "low" | "medium" | "high";

export type PwinScore = {
  probability: number;
  /** 0–100, rounded. */
  pwin: number;
  logit: number;
  priorLogit: number;
  calibrationShift: number;
  factors: PwinFactor[];
  confidence: PwinConfidence;
};

// ── math ─────────────────────────────────────────────────────────────

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function logit(p: number): number {
  const c = clamp(p, 0.001, 0.999);
  return Math.log(c / (1 - c));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── prior ────────────────────────────────────────────────────────────

/**
 * Org base rate blended toward the default: with n decided outcomes the
 * observed rate gets weight n / (n + PRIOR_PSEUDO_COUNT). Clamped so a
 * perfect or hopeless early record cannot pin the prior to the edge.
 */
export function computePrior(won: number, lost: number): PwinPrior {
  const n = Math.max(0, won) + Math.max(0, lost);
  const observed = n > 0 ? won / n : DEFAULT_BASE_RATE;
  const w = n / (n + PRIOR_PSEUDO_COUNT);
  const baseRate = clamp(w * observed + (1 - w) * DEFAULT_BASE_RATE, 0.05, 0.95);
  return { baseRate, won, lost, n };
}

// ── set-aside eligibility ────────────────────────────────────────────

/**
 * Map a free-text set-aside to the org's socio-economic profile.
 * Returns null when there is no set-aside, the wording is unrecognised,
 * or the org profile is missing — never guesses.
 */
export function setAsideEligibility(
  setAside: string,
  se: SocioEconomic | null | undefined,
): boolean | null {
  const s = setAside.toLowerCase().trim();
  if (!s || /unrestricted|full and open|none|n\/a/.test(s)) return null;
  if (!se) return null;
  const anySmall =
    se.smallBusiness || se.sba8a || se.wosb || se.sdvosb || se.hubzone || se.sdb;
  if (/8\s*\(?\s*a\s*\)?/.test(s)) return se.sba8a;
  if (/sdvosb|service[- ]?disabled/.test(s)) return se.sdvosb;
  if (/edwosb|wosb|women/.test(s)) return se.wosb;
  if (/hubzone|hub zone/.test(s)) return se.hubzone;
  if (/\bsdb\b|small disadvantaged/.test(s)) return se.sdb || se.sba8a;
  if (/small business|total small|\bsb\b|\bsba\b/.test(s)) return anySmall;
  return null;
}

// ── scoring ──────────────────────────────────────────────────────────

const EVAL_WEIGHTS: { key: keyof PwinEvaluation; label: string; weight: number }[] = [
  { key: "customerRelationship", label: "Customer relationship", weight: 0.9 },
  { key: "competitivePosture", label: "Competitive posture", weight: 0.9 },
  { key: "strategicFit", label: "Strategic fit", weight: 0.5 },
  { key: "resourceAvailability", label: "Resource availability", weight: 0.35 },
  { key: "financialAttractiveness", label: "Financial attractiveness", weight: 0.2 },
];

export function scoreFeatures(
  f: PwinFeatures,
  prior: PwinPrior,
  calibrationShift = 0,
): PwinScore {
  const factors: PwinFactor[] = [];
  const add = (key: string, label: string, logOdds: number, detail: string) => {
    if (Math.abs(logOdds) < 0.005) return;
    factors.push({ key, label, logOdds: round3(logOdds), detail });
  };

  // Evaluation dimensions: centred at 50/100, so a neutral score adds
  // nothing and the sign follows the assessor's judgement.
  if (f.evaluation) {
    for (const d of EVAL_WEIGHTS) {
      const v = clamp(f.evaluation[d.key], 0, 100);
      add(`eval_${d.key}`, d.label, ((v - 50) / 50) * d.weight, `${v}/100`);
    }
  }

  // Incumbency is the single strongest structural signal in federal
  // recompetes; only one of the three applies.
  if (f.weAreIncumbent) {
    add("incumbent_us", "We are the incumbent", 1.0, "Incumbent on record matches this organization");
  } else if (f.competitorIncumbent) {
    add("incumbent_competitor", "Competitor is incumbent", -0.8, "A tracked competitor is marked as incumbent");
  } else if (f.incumbentNamed) {
    add("incumbent_named", "Incumbent named", -0.4, "An incumbent is recorded and it is not us");
  }

  if (f.competitorCount > 2) {
    add(
      "competition",
      "Crowded field",
      Math.max(-0.6, -(f.competitorCount - 2) * 0.15),
      `${f.competitorCount} tracked competitors`,
    );
  }

  if (f.setAsideEligible === true) {
    add("set_aside_eligible", "Set-aside eligible", 0.3, "Org profile holds the certification this set-aside requires");
  } else if (f.setAsideEligible === false) {
    add("set_aside_ineligible", "Set-aside eligibility gap", -2.0, "Org profile does not show the certification this set-aside requires");
  }

  if (f.naicsInOrgList === true) {
    add("naics_match", "NAICS in org profile", 0.2, "Opportunity NAICS is one the org lists");
  } else if (f.naicsInOrgList === false) {
    add("naics_miss", "NAICS outside org profile", -0.2, "Opportunity NAICS is not in the org's list");
  }

  const history = (h: PwinHistory | null, key: string, label: string, cap: number) => {
    if (!h) return;
    const n = h.won + h.lost;
    if (n < HISTORY_MIN_N) return;
    const rate = h.won / n;
    add(key, label, clamp((rate - prior.baseRate) * 2.5, -cap, cap), `${h.won} won / ${h.lost} lost`);
  };
  history(f.agencyHistory, "agency_history", "Track record with this agency", 0.8);
  history(f.naicsHistory, "naics_history", "Track record in this NAICS", 0.6);

  if (f.readiness) {
    if (f.readiness.scanScore === "strong") {
      add("scan_strong", "Health scan: strong", 0.3, "Latest proposal scan rated strong");
    } else if (f.readiness.scanScore === "critical") {
      add("scan_critical", "Health scan: critical", -0.4, "Latest proposal scan rated critical");
    }
    if (f.readiness.complianceRatio !== null && f.readiness.complianceTotal >= 5) {
      add(
        "compliance",
        "Compliance coverage",
        (f.readiness.complianceRatio - 0.5) * 0.8,
        `${Math.round(f.readiness.complianceRatio * 100)}% of ${f.readiness.complianceTotal} items complete`,
      );
    }
  }

  const priorLogit = logit(prior.baseRate);
  const sum = factors.reduce((a, b) => a + b.logOdds, 0);
  const l = priorLogit + sum + calibrationShift;
  const probability = clamp(sigmoid(l), 0.02, 0.98);

  const hasEval = f.evaluation !== null;
  const hasHistory =
    (f.agencyHistory !== null && f.agencyHistory.won + f.agencyHistory.lost >= HISTORY_MIN_N) ||
    (f.naicsHistory !== null && f.naicsHistory.won + f.naicsHistory.lost >= HISTORY_MIN_N);
  const confidence: PwinConfidence =
    hasEval && hasHistory && prior.n >= CALIBRATION_MIN_N
      ? "high"
      : hasEval || hasHistory
        ? "medium"
        : "low";

  return {
    probability,
    pwin: Math.round(probability * 100),
    logit: l,
    priorLogit,
    calibrationShift,
    factors,
    confidence,
  };
}

// ── grading + calibration ────────────────────────────────────────────

/** Mean squared error of probabilities against outcomes. 0.25 = coin flip. */
export function brierScore(samples: { p: number; won: boolean }[]): number | null {
  if (samples.length === 0) return null;
  const sum = samples.reduce((a, s) => a + (s.p - (s.won ? 1 : 0)) ** 2, 0);
  return sum / samples.length;
}

function logLoss(samples: { logit: number; won: boolean }[], shift: number): number {
  let total = 0;
  for (const s of samples) {
    const p = clamp(sigmoid(s.logit + shift), 0.001, 0.999);
    total += s.won ? -Math.log(p) : -Math.log(1 - p);
  }
  return total / samples.length;
}

export type CalibrationFit = {
  shift: number;
  n: number;
  logLoss: number;
  logLossUnshifted: number;
  brier: number;
};

/**
 * Fit a single log-odds shift that minimises log loss over the org's
 * decided outcomes (grid search, ±2 in 0.05 steps). One parameter on
 * purpose: with tens of outcomes anything richer overfits. Returns null
 * below CALIBRATION_MIN_N.
 */
export function fitCalibrationShift(
  samples: { logit: number; won: boolean }[],
): CalibrationFit | null {
  if (samples.length < CALIBRATION_MIN_N) return null;
  let best = 0;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let s = -2; s <= 2.0001; s += 0.05) {
    const loss = logLoss(samples, s);
    if (loss < bestLoss - 1e-12) {
      bestLoss = loss;
      best = s;
    }
  }
  const shift = round3(best);
  const brier =
    brierScore(samples.map((s) => ({ p: sigmoid(s.logit + shift), won: s.won }))) ?? 0;
  return {
    shift,
    n: samples.length,
    logLoss: round3(bestLoss),
    logLossUnshifted: round3(logLoss(samples, 0)),
    brier: round3(brier),
  };
}
