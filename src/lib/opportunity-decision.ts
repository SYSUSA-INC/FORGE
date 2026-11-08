/**
 * BL-NAV-LIFECYCLE phase 2a — the Evaluate decision's rules (FORGE II
 * footnote 5; owner's choices 2026-11-06): GO and PARTNER move the
 * opportunity to Capture (stage Qualified; GO goes on to Plan without the
 * partner tasks); NO-GO closes it (No bid) and needs a category and a
 * reason in the team's own words, so FORGE can learn from it. Pure.
 */
import type { OpportunityDecisionKind, OpportunityStage } from "@/db/schema";

export const DECISION_LABELS: Record<OpportunityDecisionKind, string> = { go: "GO", no_go: "NO-GO", partner: "PARTNER" };

/** Where each decision takes the opportunity. */
export const DECISION_STAGE: Record<OpportunityDecisionKind, OpportunityStage> = { go: "qualification", no_go: "no_bid", partner: "qualification" };

export const NO_GO_CATEGORIES = [
  { key: "scope", label: "Scope isn't ours" },
  { key: "capacity", label: "No capacity or staff" },
  { key: "price", label: "Can't win on price" },
  { key: "competition", label: "Competition or incumbent too strong" },
  { key: "timing", label: "Not enough time" },
  { key: "relationship", label: "No customer relationship" },
  { key: "compliance", label: "Can't meet a requirement or set-aside" },
  { key: "other", label: "Other" },
] as const;
export type NoGoCategory = (typeof NO_GO_CATEGORIES)[number]["key"];

/** A No-Go's reason: at least this many characters of the team's own words. */
export const NO_GO_REASON_MIN = 20;

export type DecisionInput = { decision: string; category?: string; reason?: string };

/** The decision as it will be stored, or why it can't be. */
export function checkDecision(input: DecisionInput): { ok: true; decision: OpportunityDecisionKind; category: string; reason: string } | { ok: false; error: string } {
  const decision = input.decision as OpportunityDecisionKind;
  if (!Object.prototype.hasOwnProperty.call(DECISION_STAGE, decision)) return { ok: false, error: "Choose GO, NO-GO or PARTNER." };
  const reason = (input.reason ?? "").trim().slice(0, 4000);
  if (decision !== "no_go") return { ok: true, decision, category: "", reason };
  const category = NO_GO_CATEGORIES.find((c) => c.key === input.category)?.key;
  if (!category) return { ok: false, error: "Choose why it's a NO-GO." };
  if (reason.length < NO_GO_REASON_MIN) return { ok: false, error: `Say why in your own words (at least ${NO_GO_REASON_MIN} characters): FORGE learns from it.` };
  return { ok: true, decision, category, reason };
}

/** The activity note a decision leaves on the opportunity. */
export function decisionNote(d: { decision: OpportunityDecisionKind; category: string; reason: string }): string {
  const cat = NO_GO_CATEGORIES.find((c) => c.key === d.category)?.label;
  return [`Decision: ${DECISION_LABELS[d.decision]}.`, cat ? `Reason: ${cat}.` : "", d.reason].filter(Boolean).join(" ");
}

/** What an Evaluate row still needs before a decision is well-informed. */
export function decisionReadiness(r: { analysed: boolean; matrixBuilt: boolean }): string | null {
  if (!r.analysed && !r.matrixBuilt) return "Analyze it and build the capability matrix first";
  if (!r.analysed) return "Analyze it first";
  if (!r.matrixBuilt) return "Build the capability matrix first";
  return null;
}

/** The Evaluate list's filters. */
export const EVALUATE_FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_analysis", label: "Needs analysis" },
  { key: "needs_matrix", label: "Needs matrix" },
  { key: "ready", label: "Ready to decide" },
] as const;
export type EvaluateFilter = (typeof EVALUATE_FILTERS)[number]["key"];

export function evaluateFilter(v: string | undefined): EvaluateFilter {
  return EVALUATE_FILTERS.some((f) => f.key === v) ? (v as EvaluateFilter) : "all";
}

/** Whether an Evaluate row belongs under a filter: analysed or not, the matrix built or not. */
export function matchesEvaluateFilter(r: { analysed: boolean; matrixBuilt: boolean }, f: EvaluateFilter): boolean {
  if (f === "needs_analysis") return !r.analysed;
  if (f === "needs_matrix") return !r.matrixBuilt;
  if (f === "ready") return r.analysed && r.matrixBuilt;
  return true;
}

/** Days until a due date (negative once past), or null. */
export function daysLeft(dueIso: string | null, now: Date = new Date()): number | null {
  if (!dueIso) return null;
  const t = Date.parse(dueIso);
  return Number.isNaN(t) ? null : Math.ceil((t - now.getTime()) / 86_400_000);
}
