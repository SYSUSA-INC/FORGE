import type {
  ComplianceCategory,
  ComplianceOwnerStatus,
  ComplianceStatus,
} from "@/db/schema";
import { THEME } from "@/lib/theme-colors";

export const CATEGORIES: {
  key: ComplianceCategory;
  label: string;
  color: string;
  description: string;
}[] = [
  {
    key: "section_l",
    label: "Section L",
    color: THEME.plum,
    description: "Instructions to offerors — what must be submitted",
  },
  {
    key: "section_m",
    label: "Section M",
    color: THEME.brass,
    description: "Evaluation factors — how the government will score",
  },
  {
    key: "section_c",
    label: "Section C",
    color: THEME.cobalt,
    description: "Statement of Work / PWS requirements",
  },
  {
    key: "far_clause",
    label: "FAR Clause",
    color: THEME.indigo,
    description: "FAR / DFARS provisions and certifications",
  },
  {
    key: "other",
    label: "Other",
    color: THEME.muted,
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
  { key: "not_addressed", label: "Not addressed", color: THEME.muted },
  { key: "partial", label: "Partial", color: THEME.brass },
  { key: "complete", label: "Complete", color: THEME.green },
  { key: "not_applicable", label: "N/A", color: THEME.subtle },
];

export const STATUS_LABELS: Record<ComplianceStatus, string> =
  Object.fromEntries(
    STATUSES.map((s) => [s.key, s.label]),
  ) as Record<ComplianceStatus, string>;

export const STATUS_COLORS: Record<ComplianceStatus, string> =
  Object.fromEntries(
    STATUSES.map((s) => [s.key, s.color]),
  ) as Record<ComplianceStatus, string>;

export const OWNER_STATUSES: {
  key: ComplianceOwnerStatus;
  label: string;
  color: string;
}[] = [
  { key: "unassigned", label: "Unassigned", color: THEME.subtle },
  { key: "assigned", label: "Assigned", color: THEME.cobalt },
  { key: "in_progress", label: "In progress", color: THEME.brass },
  { key: "complete", label: "Done", color: THEME.green },
  { key: "blocked", label: "Blocked", color: THEME.red },
];

export const OWNER_STATUS_LABELS: Record<ComplianceOwnerStatus, string> =
  Object.fromEntries(
    OWNER_STATUSES.map((s) => [s.key, s.label]),
  ) as Record<ComplianceOwnerStatus, string>;

export const OWNER_STATUS_COLORS: Record<ComplianceOwnerStatus, string> =
  Object.fromEntries(
    OWNER_STATUSES.map((s) => [s.key, s.color]),
  ) as Record<ComplianceOwnerStatus, string>;

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
