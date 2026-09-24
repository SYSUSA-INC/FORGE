import type {
  ReviewColor,
  ReviewStatus,
  ReviewVerdict,
} from "@/db/schema";
import type { ProposalStage } from "@/db/schema";
import { THEME } from "@/lib/theme-colors";

export const REVIEW_COLORS: {
  key: ReviewColor;
  label: string;
  color: string;
  description: string;
  alignedStage: ProposalStage;
}[] = [
  {
    key: "pink",
    label: "Pink Team",
    color: THEME.plum,
    description: "First major review — strategy, themes, outline (~30%)",
    alignedStage: "pink_team",
  },
  {
    key: "red",
    label: "Red Team",
    color: THEME.red,
    description: "Independent review — evaluate against Section M (~80%)",
    alignedStage: "red_team",
  },
  {
    key: "gold",
    label: "Gold Team",
    color: THEME.brass,
    description: "Executive sign-off — near-final draft",
    alignedStage: "gold_team",
  },
  {
    key: "white_gloves",
    label: "White Gloves",
    color: THEME.text,
    description: "Copy edit, compliance sweep, production polish",
    alignedStage: "white_gloves",
  },
];

export const REVIEW_COLOR_LABELS: Record<ReviewColor, string> =
  Object.fromEntries(
    REVIEW_COLORS.map((r) => [r.key, r.label]),
  ) as Record<ReviewColor, string>;

export const REVIEW_COLOR_HEX: Record<ReviewColor, string> = Object.fromEntries(
  REVIEW_COLORS.map((r) => [r.key, r.color]),
) as Record<ReviewColor, string>;

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
};

export const STATUS_COLORS: Record<ReviewStatus, string> = {
  scheduled: THEME.subtle,
  in_progress: THEME.brass,
  complete: THEME.green,
  cancelled: THEME.muted,
};

export const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  pass: "Pass",
  conditional: "Conditional",
  fail: "Fail",
};

export const VERDICT_COLORS: Record<ReviewVerdict, string> = {
  pass: THEME.green,
  conditional: THEME.brass,
  fail: THEME.red,
};

export function computeOverallVerdict(
  verdicts: (ReviewVerdict | null | undefined)[],
): ReviewVerdict | null {
  const vs = verdicts.filter((v): v is ReviewVerdict => !!v);
  if (vs.length === 0) return null;
  if (vs.includes("fail")) return "fail";
  if (vs.includes("conditional")) return "conditional";
  return "pass";
}
