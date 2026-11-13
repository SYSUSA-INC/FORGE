/**
 * BL-SCOUT-LEARN — Scout learns from what happened to its finds.
 *
 * Pure: no database, no network. The scout (src/lib/scout.ts) reads the
 * tenant's own outcomes, embeds them once per run, and this file turns them
 * into labelled examples (how far each one got), and a new find's
 * resemblance to them into a bounded score adjustment on top of the
 * capability band (src/lib/scout-fit.ts). No training step: it is
 * recomputed each run. Per tenant only. Docs: docs/design/BL-SCOUT-FIT.md
 * §2.8 and its C2 addendum.
 */
import { cosine, findText, type CapabilityBand } from "@/lib/scout-fit";

// ── the examples ──────────────────────────────────────────────────────

/** One past find or opportunity, signed by how far it got: +1 won … −1 a scope No-Go. */
export type LearnExample = { key: string; text: string; name: string; weight: number; why: string; at: Date | null };

export type LearnFind = { id: string; title: string; agency: string; description: string; status: "imported" | "dismissed"; opportunityId: string | null; at: Date | null };
export type LearnOpportunity = { id: string; title: string; agency: string; description: string; stage: string; at: Date | null };
export type LearnDecision = { opportunityId: string; decision: string; reasonCategory: string; at: Date | null };
export type LearnOutcome = { opportunityId: string; outcome: "won" | "lost"; at: Date | null };

/** What each outcome says about whether this kind of work is for us (positive: take more like it). */
export const WEIGHTS = {
  won: 1,
  partnerOrPlan: 0.8,
  go: 0.6,
  capture: 0.5,
  lost: 0.3,
  qualified: 0.3,
  imported: 0.2,
  dismissed: -0.6,
  noBid: -0.4,
} as const;

/**
 * A No-Go says something about capability only when its reason is about
 * scope; timing, teaming (relationship) and set-aside (compliance) No-Gos
 * say nothing about whether the work suits the company, so they are weak.
 */
export const NO_GO_WEIGHTS: Record<string, number> = {
  scope: -1,
  other: -0.5,
  capacity: -0.4,
  price: -0.3,
  competition: -0.3,
  timing: -0.15,
  relationship: -0.15,
  compliance: -0.15,
};
const NO_GO_UNKNOWN = -0.5;

const NO_GO_LABEL: Record<string, string> = {
  scope: "scope isn't ours",
  capacity: "no capacity",
  price: "price",
  competition: "competition",
  timing: "timing",
  relationship: "no relationship",
  compliance: "a requirement or set-aside",
  other: "other",
};

const CAPTURE_STAGES = new Set(["capture", "pre_proposal", "writing", "submitted"]);
const MAX_EXAMPLES = 300;
const NAME_CHARS = 80;

export function noGoWeight(category: string): number {
  return NO_GO_WEIGHTS[category] ?? NO_GO_UNKNOWN;
}

/** The text an example is embedded as: shorter than a find's, since a title and agency carry the line of work. */
export function exampleText(e: { title: string; agency: string; description: string }): string {
  return findText({ title: e.title, agency: e.agency, description: e.description.slice(0, 2000) });
}

type Verdict = { weight: number; why: string };

/** What one opportunity's history says: a pursuit's outcome, else its latest decision, else how far its stage got. */
function verdictFor(stage: string, decision: LearnDecision | undefined, outcome: LearnOutcome["outcome"] | undefined, scoutFound: boolean): Verdict | null {
  if (outcome === "won" || stage === "won") return { weight: WEIGHTS.won, why: "which you won" };
  if (outcome === "lost" || stage === "lost") return { weight: WEIGHTS.lost, why: "which you pursued and lost" };
  const stageW = CAPTURE_STAGES.has(stage) ? WEIGHTS.capture : stage === "qualification" ? WEIGHTS.qualified : scoutFound ? WEIGHTS.imported : 0;
  const stageWhy = CAPTURE_STAGES.has(stage) ? "which you took to Capture" : stage === "qualification" ? "which you took to Qualification" : "which you added to your pipeline";
  if (decision) {
    if (decision.decision === "no_go") {
      return { weight: noGoWeight(decision.reasonCategory), why: `which you marked No-Go${NO_GO_LABEL[decision.reasonCategory] ? ` (${NO_GO_LABEL[decision.reasonCategory]})` : ""}` };
    }
    if (decision.decision === "partner") return { weight: Math.max(WEIGHTS.partnerOrPlan, stageW), why: "which you chose to partner on" };
    if (decision.decision === "plan") return { weight: Math.max(WEIGHTS.partnerOrPlan, stageW), why: "which you moved to a plan" };
    if (decision.decision === "go") return stageW > WEIGHTS.go ? { weight: stageW, why: stageWhy } : { weight: WEIGHTS.go, why: "which you took to Go" };
  }
  if (stage === "no_bid") return { weight: WEIGHTS.noBid, why: "which you set aside as No bid" };
  return stageW ? { weight: stageW, why: stageWhy } : null;
}

export type LearnSources = {
  finds: LearnFind[];
  opportunities: LearnOpportunity[];
  decisions: LearnDecision[];
  outcomes: LearnOutcome[];
  /** An admin's reset: outcomes at or before this are not read. */
  resetAt: Date | null;
};

/**
 * Every labelled example this tenant's history gives, newest first and
 * capped. A find the team imported is read through its opportunity (so its
 * decision and outcome count); a dismissed find, or an import whose
 * opportunity is gone, stands on its own.
 */
export function buildLearningExamples(src: LearnSources): LearnExample[] {
  const latestDecision = new Map<string, LearnDecision>();
  for (const d of src.decisions) {
    const cur = latestDecision.get(d.opportunityId);
    if (!cur || (d.at?.getTime() ?? 0) >= (cur.at?.getTime() ?? 0)) latestDecision.set(d.opportunityId, d);
  }
  const outcomeOf = new Map<string, LearnOutcome>();
  for (const o of src.outcomes) {
    const cur = outcomeOf.get(o.opportunityId);
    if (!cur || o.outcome === "won") outcomeOf.set(o.opportunityId, o);
  }
  const scoutFound = new Set(src.finds.map((f) => f.opportunityId).filter((x): x is string => !!x));
  const oppIds = new Set(src.opportunities.map((o) => o.id));
  const out: LearnExample[] = [];

  for (const o of src.opportunities) {
    const decision = latestDecision.get(o.id);
    const outcome = outcomeOf.get(o.id);
    const v = verdictFor(o.stage, decision, outcome?.outcome, scoutFound.has(o.id));
    if (!v) continue;
    const at = [outcome?.at, decision?.at, o.at].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    out.push({ key: `opp:${o.id}`, text: exampleText(o), name: o.title.slice(0, NAME_CHARS), weight: v.weight, why: v.why, at });
  }
  for (const f of src.finds) {
    if (f.opportunityId && oppIds.has(f.opportunityId)) continue;
    const dismissed = f.status === "dismissed";
    out.push({
      key: `find:${f.id}`,
      text: exampleText(f),
      name: f.title.slice(0, NAME_CHARS),
      weight: dismissed ? WEIGHTS.dismissed : WEIGHTS.imported,
      why: dismissed ? "which you passed on" : "which you added to your pipeline",
      at: f.at,
    });
  }

  const reset = src.resetAt?.getTime() ?? null;
  return out
    .filter((e) => e.text.trim().length >= 6 && (reset === null || (e.at !== null && e.at.getTime() > reset)))
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, MAX_EXAMPLES);
}

// ── the guards ────────────────────────────────────────────────────────

/** Decision 11: off below 20 labelled outcomes (5 or more positive), ±5 until 50, ±10 after. */
export const MIN_LABELLED = 20;
export const MIN_POSITIVE = 5;
export const FULL_AT = 50;
export const CAP_EARLY = 5;
export const CAP_FULL = 10;

export type LearningState = {
  mode: "disabled" | "waiting" | "early" | "full";
  /** The most the signal may move a score: 0 when it is not acting. */
  cap: number;
  labelled: number;
  positives: number;
  negatives: number;
};

export function learningState(examples: LearnExample[], enabled: boolean): LearningState {
  const positives = examples.filter((e) => e.weight > 0).length;
  const negatives = examples.filter((e) => e.weight < 0).length;
  const labelled = positives + negatives;
  const base = { labelled, positives, negatives };
  if (!enabled) return { mode: "disabled", cap: 0, ...base };
  if (labelled < MIN_LABELLED || positives < MIN_POSITIVE) return { mode: "waiting", cap: 0, ...base };
  return labelled < FULL_AT ? { mode: "early", cap: CAP_EARLY, ...base } : { mode: "full", cap: CAP_FULL, ...base };
}

/** The line the Scout tab and the run note show. */
export function learningLine(s: LearningState): string {
  if (s.mode === "disabled") return "Learning from outcomes is switched off.";
  if (s.mode === "waiting") {
    const more = Math.max(MIN_LABELLED - s.labelled, 0);
    const pos = Math.max(MIN_POSITIVE - s.positives, 0);
    const needs = [more > 0 ? `${more} more decided find${more === 1 ? "" : "s"}` : "", pos > 0 ? `${pos} more taken forward` : ""].filter(Boolean).join(" and ");
    return `Scout is not learning from outcomes yet: ${s.labelled} so far (${s.positives} taken forward); it starts at ${MIN_LABELLED} decided with ${MIN_POSITIVE} taken forward${needs ? `, so ${needs}` : ""}.`;
  }
  return `Learning from ${s.labelled} outcomes (${s.positives} taken forward, ${s.negatives} set aside)${s.mode === "early" ? `; its effect is held to ±${s.cap} until ${FULL_AT}` : ""}.`;
}

// ── affinity ──────────────────────────────────────────────────────────

/** Below this cosine a past example is not "like" the find. */
export const RESEMBLE_SIM = 0.4;
const NEIGHBOURS = 5;
/** The best Related finds that resemble nothing before, always kept in view. */
export const EXPLORATION_SLICE = 3;
export const EXPLORATION_BOOST = 5;
export const LEARNED_PREFIX = "Learned: ";

export type Affinity = { adjustment: number; resembles: boolean; basis: string };

/**
 * How much a find resembles what the team took forward against what it set
 * aside: the weighted mean of its nearest examples' weights, scaled by how
 * close they are, times the cap. Zero when nothing is close.
 */
export function affinityFor(vec: number[], examples: LearnExample[], exampleVecs: number[][], cap: number): Affinity {
  const near: { ex: LearnExample; sim: number }[] = [];
  for (let i = 0; i < examples.length; i++) {
    const v = exampleVecs[i];
    if (!v) continue;
    const sim = cosine(vec, v);
    if (sim >= RESEMBLE_SIM) near.push({ ex: examples[i]!, sim });
  }
  if (near.length === 0) return { adjustment: 0, resembles: false, basis: "" };
  near.sort((a, b) => b.sim - a.sim);
  const top = near.slice(0, NEIGHBOURS);
  const total = top.reduce((s, n) => s + n.sim, 0);
  const value = top.reduce((s, n) => s + n.ex.weight * n.sim, 0) / total;
  const closeness = Math.max(0, Math.min(1, (top[0]!.sim - RESEMBLE_SIM) / (0.75 - RESEMBLE_SIM)));
  const adjustment = Math.round(cap * value * (0.4 + 0.6 * closeness));
  if (adjustment === 0) return { adjustment: 0, resembles: true, basis: "" };
  // The example that pulled hardest in the direction it moved.
  const lead = top.filter((n) => Math.sign(n.ex.weight) === Math.sign(adjustment)).sort((a, b) => Math.abs(b.ex.weight) * b.sim - Math.abs(a.ex.weight) * a.sim)[0] ?? top[0]!;
  return { adjustment, resembles: true, basis: `Similar to “${lead.ex.name}”, ${lead.ex.why}` };
}

export type LearnItem = { vec: number[] | null; band: CapabilityBand | null; score: number };
export type LearnResult = { affinity: number | null; signal: string | null; score: number };

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function learnedSignal(adjustment: number, basis: string): string {
  return `${LEARNED_PREFIX}${adjustment > 0 ? "+" : ""}${adjustment}. ${basis}`;
}

/** Signals from an earlier scoring, without the learned line, so re-scoring never doubles it. */
export function withoutLearnedSignal(signals: string[]): string[] {
  return signals.filter((s) => !s.startsWith(LEARNED_PREFIX));
}

/**
 * The learned adjustment for a batch of finds (one run's new finds, or the
 * waiting ones re-scored). Nothing changes while the state is not acting;
 * a Weak find is neither raised nor lowered (capability stays in charge);
 * no adjustment can hide a find, since only the capability band does that.
 * The best few Related finds that resemble nothing decided before get a
 * small lift and a line saying so, so a new line of work still surfaces.
 */
export function applyLearning(items: LearnItem[], examples: LearnExample[], exampleVecs: number[][], state: LearningState): LearnResult[] {
  const out: LearnResult[] = items.map((i) => ({ affinity: null, signal: null, score: i.score }));
  if (state.cap <= 0 || examples.length === 0) return out;
  const fresh: number[] = [];
  items.forEach((it, i) => {
    if (!it.vec || it.band === "weak") return;
    const a = affinityFor(it.vec, examples, exampleVecs, state.cap);
    out[i] = { affinity: a.adjustment, signal: a.adjustment !== 0 ? learnedSignal(a.adjustment, a.basis) : null, score: clamp(it.score + a.adjustment) };
    if (!a.resembles && it.band === "related") fresh.push(i);
  });
  fresh
    .sort((a, b) => items[b]!.score - items[a]!.score)
    .slice(0, EXPLORATION_SLICE)
    .forEach((i) => {
      const lift = Math.min(EXPLORATION_BOOST, state.cap);
      out[i] = { affinity: lift, signal: learnedSignal(lift, "New line of work: it resembles nothing you have decided before, so it is kept in view"), score: clamp(items[i]!.score + lift) };
    });
  return out;
}
