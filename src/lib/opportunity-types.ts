import type { OpportunityStage } from "@/db/schema";
import { THEME } from "@/lib/theme-colors";

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
    color: THEME.cobaltLight,
  },
  {
    key: "sources_sought",
    label: "Evaluated",
    shortLabel: "S2",
    phase: "capture",
    color: THEME.cobaltLight,
  },
  {
    key: "qualification",
    label: "Qualified",
    shortLabel: "S3",
    phase: "capture",
    color: THEME.cobalt,
  },
  {
    key: "capture",
    label: "Captured",
    shortLabel: "S4",
    phase: "capture",
    color: THEME.green,
  },
  {
    key: "pre_proposal",
    label: "Developed",
    shortLabel: "S5",
    phase: "proposal",
    color: THEME.indigo,
  },
  {
    key: "submitted",
    label: "Submitted",
    shortLabel: "S6",
    phase: "proposal",
    color: THEME.plumDeep,
  },
  {
    key: "won",
    label: "Closed-Won",
    shortLabel: "W",
    phase: "closed",
    color: THEME.green,
  },
  {
    key: "lost",
    label: "Archived · Lost",
    shortLabel: "L",
    phase: "closed",
    color: THEME.red,
  },
  {
    key: "no_bid",
    label: "Archived · No bid",
    shortLabel: "NB",
    phase: "closed",
    color: THEME.subtle,
  },
];

/**
 * BL-PIPE-STAGES (owner, 2026-10-24) — the stages read as the reference
 * funnel: Identified · Evaluated · Qualified · Captured · Developed ·
 * Submitted · Closed-Won · Archived. The stored keys are unchanged, so
 * the API, stage history and imports keep working. "writing" merged
 * into "pre_proposal" (Developed): migration 0134 moved the rows, the
 * enum value stays, and `canonicalStage` folds any straggler.
 */
export function canonicalStage(stage: OpportunityStage): OpportunityStage {
  return stage === "writing" ? "pre_proposal" : stage;
}

export const STAGE_LABELS = {
  ...Object.fromEntries(STAGES.map((s) => [s.key, s.label])),
  writing: "Developed",
} as Record<OpportunityStage, string>;

export const STAGE_COLORS = {
  ...Object.fromEntries(STAGES.map((s) => [s.key, s.color])),
  writing: STAGES.find((s) => s.key === "pre_proposal")!.color,
} as Record<OpportunityStage, string>;

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
