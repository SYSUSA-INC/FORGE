import type { CapabilityAnswer, CapabilityQuestion } from "@/lib/capability-matrix-types";

/**
 * BL-CAP-MATRIX phase B — what the questionnaire's answers add up to:
 * a coverage score, the gaps, whether a partner is needed, and the
 * feature PWin reads. Pure: no DB, no AI.
 *
 * Owner decisions (2026-10-25): teaming is flagged under 70% coverage of
 * `shall` requirements; the PWin factor is worth up to ±1.0 log-odds.
 */

/** Below this share of `shall` coverage, teaming is recommended. */
export const CAPABILITY_TEAMING_THRESHOLD = 0.7;
/** PWin only reads a questionnaire that is at least this answered. */
export const CAPABILITY_PWIN_MIN_ANSWERED_SHARE = 0.6;
/** ... and with at least this many answered questions. */
export const CAPABILITY_PWIN_MIN_ANSWERED = 5;

/** How much of a requirement each answer covers. A partner gap counts only once a partner is named. */
const ANSWER_COVER: Record<CapabilityAnswer["value"], number> = {
  have_proven: 1,
  have_unproven: 0.75,
  partial: 0.5,
  gap_partner: 0,
  gap_none: 0,
  na: 0,
};
const PARTNER_NAMED_COVER = 0.6;

/** Standing questions weigh like `shall`; the kinds follow the requirement they cover. */
const KIND_WEIGHT: Record<CapabilityQuestion["kind"], number> = {
  shall: 1,
  standing: 1,
  should: 0.5,
  may: 0.25,
};

export type CapabilityGap = {
  questionId: string;
  text: string;
  refs: string[];
  kind: CapabilityQuestion["kind"];
  /** gap_partner or gap_none */
  value: "gap_partner" | "gap_none";
  partnerNamed: boolean;
};

export type CapabilityCoverage = {
  /** Weighted share covered, over answered and applicable questions; null when none answered. */
  coverage: number | null;
  /** The same share over `shall` and standing questions only; the teaming rule reads this. */
  shallCoverage: number | null;
  total: number;
  answered: number;
  /** Answered and not N/A. */
  applicable: number;
  gaps: CapabilityGap[];
  /** A `shall`/standing gap answered "partner needed", or shall coverage under the threshold. */
  partnerNeeded: boolean;
  /** Gaps that already name a partner. */
  partnerCovered: number;
  /** `shall`/standing gaps with no partner named. */
  shallGapsOpen: number;
};

export function computeCapabilityCoverage(
  questions: CapabilityQuestion[],
  answers: Record<string, CapabilityAnswer>,
): CapabilityCoverage {
  let num = 0;
  let den = 0;
  let shallNum = 0;
  let shallDen = 0;
  let answered = 0;
  let applicable = 0;
  const gaps: CapabilityGap[] = [];
  let partnerFlag = false;
  let partnerCovered = 0;
  let shallGapsOpen = 0;

  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    answered += 1;
    if (a.value === "na") continue;
    applicable += 1;
    const w = KIND_WEIGHT[q.kind];
    const partnerNamed = a.value === "gap_partner" && !!a.partnerCompanyId;
    const cover = partnerNamed ? PARTNER_NAMED_COVER : ANSWER_COVER[a.value];
    num += w * cover;
    den += w;
    const isShall = q.kind === "shall" || q.kind === "standing";
    if (isShall) {
      shallNum += cover;
      shallDen += 1;
    }
    if (a.value === "gap_partner" || a.value === "gap_none") {
      gaps.push({ questionId: q.id, text: q.text, refs: q.refs, kind: q.kind, value: a.value, partnerNamed });
      if (partnerNamed) partnerCovered += 1;
      if (isShall) {
        if (a.value === "gap_partner") partnerFlag = true;
        if (!partnerNamed) shallGapsOpen += 1;
      }
    }
  }

  const coverage = den > 0 ? num / den : null;
  const shallCoverage = shallDen > 0 ? shallNum / shallDen : null;
  const partnerNeeded =
    partnerFlag || (shallCoverage !== null && shallCoverage < CAPABILITY_TEAMING_THRESHOLD);

  return {
    coverage,
    shallCoverage,
    total: questions.length,
    answered,
    applicable,
    gaps,
    partnerNeeded,
    partnerCovered,
    shallGapsOpen,
  };
}

export type CapabilityPwinFeature = {
  /** 0..1 */
  coverage: number;
  shallGapsOpen: number;
  partnerCovered: number;
  answered: number;
  total: number;
};

/** The PWin feature, or null while the questionnaire is too empty to trust. */
export function capabilityPwinFeature(c: CapabilityCoverage): CapabilityPwinFeature | null {
  if (c.coverage === null || c.total === 0) return null;
  if (c.answered < CAPABILITY_PWIN_MIN_ANSWERED) return null;
  if (c.answered / c.total < CAPABILITY_PWIN_MIN_ANSWERED_SHARE) return null;
  return {
    coverage: c.coverage,
    shallGapsOpen: c.shallGapsOpen,
    partnerCovered: c.partnerCovered,
    answered: c.answered,
    total: c.total,
  };
}
