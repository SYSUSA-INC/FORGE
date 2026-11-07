/**
 * BL-NAV-LIFECYCLE phase 3a (FORGE II footnote 6, C-1, C-11) — Capture's
 * rules (owner's choices 2026-11-07): a GO opportunity can move to Plan
 * at once; a PARTNER one once a partner is chosen, with the teaming
 * agreement shown as still to do until the agreement module (phase 8).
 * Pure.
 */
import type { OpportunityDecisionKind, OpportunityPartnerStatus, OpportunityStage } from "@/db/schema";

/** Where Move to Plan takes the opportunity (Plan lists "Captured"). */
export const PLAN_STAGE: OpportunityStage = "capture";
/** The stage Capture lists. */
export const CAPTURE_STAGE: OpportunityStage = "qualification";

export const PARTNER_STATUS_LABELS: Record<OpportunityPartnerStatus, string> = {
  candidate: "Candidate",
  invited: "Invited",
  answered: "Answered",
  chosen: "Chosen",
  declined: "Declined",
};

export type PartnerCounts = Record<OpportunityPartnerStatus, number>;

export function emptyPartnerCounts(): PartnerCounts {
  return { candidate: 0, invited: 0, answered: 0, chosen: 0, declined: 0 };
}

/** Whether Move to Plan is open, or what stands in the way. */
export function planBlocker(input: { stage: OpportunityStage; decision: OpportunityDecisionKind | null; chosen: number }): string | null {
  if (input.stage !== CAPTURE_STAGE) return "Only an opportunity in Capture (Qualified) moves to Plan from here.";
  if (input.decision === "no_go") return "This opportunity was decided NO-GO.";
  if (input.decision === "partner" && input.chosen === 0) return "Choose a partner first: this opportunity was decided PARTNER.";
  return null;
}

export type CaptureNextStep = "find_partners" | "choose_partner" | "move_to_plan";

/** What a Capture row asks for next. */
export function captureNextStep(input: { decision: OpportunityDecisionKind | null; counts: PartnerCounts }): CaptureNextStep {
  if (input.decision !== "partner") return "move_to_plan";
  if (input.counts.chosen > 0) return "move_to_plan";
  const live = input.counts.candidate + input.counts.invited + input.counts.answered;
  return live > 0 ? "choose_partner" : "find_partners";
}

export const NEXT_STEP_LABELS: Record<CaptureNextStep, string> = {
  find_partners: "Find partners",
  choose_partner: "Choose a partner",
  move_to_plan: "Move to Plan",
};

/** The activity note Move to Plan leaves. */
export function planNote(input: { decision: OpportunityDecisionKind | null; chosenNames: string[] }): string {
  if (input.decision === "partner" && input.chosenNames.length > 0) {
    return `Moved to Plan with ${input.chosenNames.join(", ")} as partner${input.chosenNames.length === 1 ? "" : "s"}. Teaming agreement: to do.`;
  }
  return "Moved to Plan.";
}
