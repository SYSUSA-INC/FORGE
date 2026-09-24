/**
 * BL-AIP-1 — the one mapping between a proposal outcome and the
 * opportunity stage it implies, and the notification-rule event a stage
 * change fires.
 *
 * Pure, so the gate decision (`setStageWithLogAction`), the outcome
 * save (`saveOutcomeAction`) and the tests all read the same table. The
 * 2026-09 AI-platform assessment found the two writers disagreeing: the
 * gate decision never fired a rules event and the outcome save never
 * moved the opportunity, so PWin, loss intelligence and the recompete
 * radar saw only half the decisions.
 */
import type { OpportunityStage, ProposalOutcomeType } from "@/db/schema";

export type OpportunityStageRuleKind =
  | "opportunity_won"
  | "opportunity_lost"
  | "opportunity_no_bid"
  | "opportunity_advanced";

/** The opportunity stage a recorded proposal outcome implies. */
export function stageForOutcome(outcome: ProposalOutcomeType): OpportunityStage {
  switch (outcome) {
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "no_bid":
    case "withdrawn":
      return "no_bid";
  }
}

/** Terminal stages: the pursuit is decided. */
export function isClosedStage(stage: OpportunityStage): boolean {
  return stage === "won" || stage === "lost" || stage === "no_bid";
}

/**
 * BL-13 — terminal stages map to their narrower closed-state events so
 * rules can target won / lost / no-bid independently of the general
 * "advanced" event.
 */
export function ruleKindForStage(stage: OpportunityStage): OpportunityStageRuleKind {
  switch (stage) {
    case "won":
      return "opportunity_won";
    case "lost":
      return "opportunity_lost";
    case "no_bid":
      return "opportunity_no_bid";
    default:
      return "opportunity_advanced";
  }
}
