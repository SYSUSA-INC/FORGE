import type { OpportunityStage } from "@/db/schema";

export const STAGES: {
  key: OpportunityStage;
  label: string;
  shortLabel: string;
  phase: "capture" | "proposal" | "closed";
  color: string;
}[] = [
  {
    key: "identified",
    label: "Identified",
    shortLabel: "S1",
    phase: "capture",
    color: "#A5F3FC",
  },
  {
    key: "sources_sought",
    label: "Sources Sought / RFI",
    shortLabel: "S2",
    phase: "capture",
    color: "#67E8F9",
  },
  {
    key: "qualification",
    label: "Qualification",
    shortLabel: "S3",
    phase: "capture",
    color: "#2DD4BF",
  },
  {
    key: "capture",
    label: "Capture",
    shortLabel: "S4",
    phase: "capture",
    color: "#34D399",
  },
  {
    key: "pre_proposal",
    label: "Pre-Proposal",
    shortLabel: "S5",
    phase: "proposal",
    color: "#8B5CF6",
  },
  {
    key: "writing",
    label: "Writing",
    shortLabel: "S6",
    phase: "proposal",
    color: "#EC4899",
  },
  {
    key: "submitted",
    label: "Submitted",
    shortLabel: "S7",
    phase: "proposal",
    color: "#BE185D",
  },
  {
    key: "won",
    label: "Won",
    shortLabel: "W",
    phase: "closed",
    color: "#10B981",
  },
  {
    key: "lost",
    label: "Lost",
    shortLabel: "L",
    phase: "closed",
    color: "#F43F5E",
  },
  {
    key: "no_bid",
    label: "No Bid",
    shortLabel: "NB",
    phase: "closed",
    color: "#64748B",
  },
];

export const STAGE_LABELS: Record<OpportunityStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.label]),
) as Record<OpportunityStage, string>;

export const STAGE_COLORS: Record<OpportunityStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.color]),
) as Record<OpportunityStage, string>;

export const CONTRACT_TYPES = [
  "",
  "FFP",
  "T&M",
  "CPFF",
  "CPIF",
  "CPAF",
  "IDIQ",
  "BPA",
  "Other",
];

export const SET_ASIDES = [
  "",
  "Full & Open",
  "Small Business",
  "8(a)",
  "SDVOSB",
  "WOSB",
  "HUBZone",
  "Sole Source",
];
