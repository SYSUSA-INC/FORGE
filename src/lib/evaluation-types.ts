import type {
  OpportunityActivityKind,
  OpportunityEvaluation,
} from "@/db/schema";

export const EVALUATION_DIMENSIONS: {
  key: keyof Omit<OpportunityEvaluation, "opportunityId" | "rationale" | "updatedAt">;
  label: string;
  description: string;
}[] = [
  {
    key: "strategicFit",
    label: "Strategic fit",
    description: "Alignment with your company's core competencies and growth strategy",
  },
  {
    key: "customerRelationship",
    label: "Customer relationship",
    description: "Strength of existing relationships, customer knowledge, and trust",
  },
  {
    key: "competitivePosture",
    label: "Competitive posture",
    description: "Your position vs. incumbents and likely competitors",
  },
  {
    key: "resourceAvailability",
    label: "Resource availability",
    description: "Staff, SMEs, facilities, and clearances available to execute",
  },
  {
    key: "financialAttractiveness",
    label: "Financial attractiveness",
    description: "Contract value, margin, payment terms, and strategic value",
  },
];

export function evaluationRollup(e: OpportunityEvaluation | null): number {
  if (!e) return 0;
  const scores = EVALUATION_DIMENSIONS.map((d) => e[d.key] ?? 0);
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export const ACTIVITY_KIND_LABELS: Record<OpportunityActivityKind, string> = {
  note: "Note",
  meeting: "Meeting",
  action: "Action",
  stage_change: "Stage change",
  gate_decision: "Bid/no-bid decision",
  evaluation_update: "Evaluation updated",
  competitor_update: "Competitor",
  owner_change: "Owner change",
};

export const ACTIVITY_KIND_COLORS: Record<OpportunityActivityKind, string> = {
  note: "#94A3B8",
  meeting: "#60A5FA",
  action: "#34D399",
  stage_change: "#8B5CF6",
  gate_decision: "#F59E0B",
  evaluation_update: "#2DD4BF",
  competitor_update: "#EC4899",
  owner_change: "#A78BFA",
};

export const MANUAL_ACTIVITY_KINDS: OpportunityActivityKind[] = [
  "note",
  "meeting",
  "action",
];
