import type {
  ProposalDebriefFormat,
  ProposalDebriefStatus,
  ProposalOutcomeReason,
  ProposalOutcomeType,
  ProposalStage,
} from "@/db/schema";

export const OUTCOME_TYPE_LABELS: Record<ProposalOutcomeType, string> = {
  won: "Won",
  lost: "Lost",
  no_bid: "No Bid",
  withdrawn: "Withdrawn",
};

export const OUTCOME_TYPE_COLORS: Record<ProposalOutcomeType, string> = {
  won: "#10B981",
  lost: "#EF4444",
  no_bid: "#64748B",
  withdrawn: "#94A3B8",
};

export const OUTCOME_REASON_LABELS: Record<ProposalOutcomeReason, string> = {
  price: "Price",
  technical: "Technical approach",
  past_performance: "Past performance",
  management: "Management approach",
  relationship: "Customer relationship",
  schedule: "Schedule",
  requirements_fit: "Requirements fit",
  competition: "Competitive position",
  compliance_gap: "Compliance gap",
  other: "Other",
};

export const OUTCOME_REASONS: ProposalOutcomeReason[] = [
  "price",
  "technical",
  "past_performance",
  "management",
  "relationship",
  "schedule",
  "requirements_fit",
  "competition",
  "compliance_gap",
  "other",
];

export const DEBRIEF_STATUS_LABELS: Record<ProposalDebriefStatus, string> = {
  not_requested: "Not requested",
  requested: "Requested",
  scheduled: "Scheduled",
  held: "Held",
  declined_by_govt: "Declined by govt",
  not_offered: "Not offered",
  waived: "Waived",
};

export const DEBRIEF_FORMAT_LABELS: Record<ProposalDebriefFormat, string> = {
  written: "Written",
  oral: "Oral",
  both: "Written + Oral",
  unknown: "Unknown",
};

export const TERMINAL_STAGES: ProposalStage[] = [
  "awarded",
  "lost",
  "no_bid",
];

export function stageImpliesOutcome(
  stage: ProposalStage,
): ProposalOutcomeType | null {
  if (stage === "awarded") return "won";
  if (stage === "lost") return "lost";
  if (stage === "no_bid") return "no_bid";
  return null;
}

export function isTerminalStage(stage: ProposalStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}
