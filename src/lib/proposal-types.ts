import type { ProposalSectionKind, ProposalStage, ProposalSectionStatus } from "@/db/schema";

export const STAGES: {
  key: ProposalStage;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}[] = [
  {
    key: "draft",
    label: "Draft",
    shortLabel: "Draft",
    color: "#94A3B8",
    description: "Initial authoring before color-team reviews begin",
  },
  {
    key: "pink_team",
    label: "Pink Team",
    shortLabel: "Pink",
    color: "#F472B6",
    description: "First major review — strategy, themes, outline (~30% complete)",
  },
  {
    key: "red_team",
    label: "Red Team",
    shortLabel: "Red",
    color: "#F43F5E",
    description: "Independent evaluator review — score against Section M (~80%)",
  },
  {
    key: "gold_team",
    label: "Gold Team",
    shortLabel: "Gold",
    color: "#F59E0B",
    description: "Executive / sign-off review — near-final draft",
  },
  {
    key: "white_gloves",
    label: "White Gloves",
    shortLabel: "White",
    color: "#E2E8F0",
    description: "Final copy edit, compliance sweep, production polish",
  },
  {
    key: "submitted",
    label: "Submitted",
    shortLabel: "Sub.",
    color: "#2DD4BF",
    description: "Delivered to the customer",
  },
  {
    key: "awarded",
    label: "Awarded",
    shortLabel: "Won",
    color: "#10B981",
    description: "Contract won",
  },
  {
    key: "lost",
    label: "Lost",
    shortLabel: "Lost",
    color: "#EF4444",
    description: "Not selected",
  },
  {
    key: "no_bid",
    label: "No Bid",
    shortLabel: "NB",
    color: "#64748B",
    description: "Decided not to pursue",
  },
  {
    key: "archived",
    label: "Archived",
    shortLabel: "Arc.",
    color: "#475569",
    description: "Archived proposal",
  },
];

export const STAGE_LABELS: Record<ProposalStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.label]),
) as Record<ProposalStage, string>;

export const STAGE_COLORS: Record<ProposalStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.color]),
) as Record<ProposalStage, string>;

export const DEFAULT_SECTIONS: {
  kind: ProposalSectionKind;
  title: string;
  ordering: number;
}[] = [
  { kind: "executive_summary", title: "Executive Summary", ordering: 1 },
  { kind: "technical", title: "Technical Approach", ordering: 2 },
  { kind: "management", title: "Management Approach", ordering: 3 },
  { kind: "past_performance", title: "Past Performance", ordering: 4 },
  { kind: "pricing", title: "Price Volume", ordering: 5 },
  { kind: "compliance", title: "Compliance Matrix", ordering: 6 },
];

export const SECTION_KIND_LABELS: Record<ProposalSectionKind, string> = {
  executive_summary: "Executive Summary",
  technical: "Technical",
  management: "Management",
  past_performance: "Past Performance",
  pricing: "Pricing",
  compliance: "Compliance",
};

export const SECTION_STATUS_LABELS: Record<ProposalSectionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  draft_complete: "Draft complete",
  in_review: "In review",
  approved: "Approved",
};

export const SECTION_STATUS_COLORS: Record<ProposalSectionStatus, string> = {
  not_started: "#64748B",
  in_progress: "#F59E0B",
  draft_complete: "#2DD4BF",
  in_review: "#A78BFA",
  approved: "#10B981",
};

export function countWords(text: string): number {
  const stripped = text.trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).length;
}

export function advanceStage(from: ProposalStage): ProposalStage | null {
  const order: ProposalStage[] = [
    "draft",
    "pink_team",
    "red_team",
    "gold_team",
    "white_gloves",
    "submitted",
  ];
  const idx = order.indexOf(from);
  if (idx === -1 || idx === order.length - 1) return null;
  return order[idx + 1]!;
}
