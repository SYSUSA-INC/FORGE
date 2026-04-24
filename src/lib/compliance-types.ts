import type {
  ComplianceCategory,
  ComplianceStatus,
} from "@/db/schema";

export const CATEGORIES: {
  key: ComplianceCategory;
  label: string;
  color: string;
  description: string;
}[] = [
  {
    key: "section_l",
    label: "Section L",
    color: "#F472B6",
    description: "Instructions to offerors — what must be submitted",
  },
  {
    key: "section_m",
    label: "Section M",
    color: "#FBBF24",
    description: "Evaluation factors — how the government will score",
  },
  {
    key: "section_c",
    label: "Section C",
    color: "#2DD4BF",
    description: "Statement of Work / PWS requirements",
  },
  {
    key: "far_clause",
    label: "FAR Clause",
    color: "#A78BFA",
    description: "FAR / DFARS provisions and certifications",
  },
  {
    key: "other",
    label: "Other",
    color: "#94A3B8",
    description: "Any other requirement needing traceability",
  },
];

export const CATEGORY_LABELS: Record<ComplianceCategory, string> =
  Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.label]),
  ) as Record<ComplianceCategory, string>;

export const CATEGORY_COLORS: Record<ComplianceCategory, string> =
  Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.color]),
  ) as Record<ComplianceCategory, string>;

export const STATUSES: {
  key: ComplianceStatus;
  label: string;
  color: string;
}[] = [
  { key: "not_addressed", label: "Not addressed", color: "#94A3B8" },
  { key: "partial", label: "Partial", color: "#F59E0B" },
  { key: "complete", label: "Complete", color: "#10B981" },
  { key: "not_applicable", label: "N/A", color: "#64748B" },
];

export const STATUS_LABELS: Record<ComplianceStatus, string> =
  Object.fromEntries(
    STATUSES.map((s) => [s.key, s.label]),
  ) as Record<ComplianceStatus, string>;

export const STATUS_COLORS: Record<ComplianceStatus, string> =
  Object.fromEntries(
    STATUSES.map((s) => [s.key, s.color]),
  ) as Record<ComplianceStatus, string>;

export function computeCompletion(items: { status: ComplianceStatus }[]): {
  complete: number;
  partial: number;
  notAddressed: number;
  na: number;
  total: number;
  percent: number;
} {
  let complete = 0;
  let partial = 0;
  let notAddressed = 0;
  let na = 0;
  for (const item of items) {
    if (item.status === "complete") complete++;
    else if (item.status === "partial") partial++;
    else if (item.status === "not_applicable") na++;
    else notAddressed++;
  }
  const total = items.length;
  const considered = total - na;
  const score = complete + partial * 0.5;
  const percent =
    considered === 0 ? 0 : Math.round((score / considered) * 100);
  return { complete, partial, notAddressed, na, total, percent };
}
