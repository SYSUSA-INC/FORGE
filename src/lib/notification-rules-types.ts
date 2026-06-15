/**
 * BL-13 — Notification rules engine shared types.
 *
 * Lives in src/lib/ so server + client modules can both reference the
 * canonical shapes without crossing the "use server" boundary. Phase A
 * keeps this minimal — labels for UI, type-narrowed payload shapes for
 * each recipient strategy. Phase B will add zod schemas + parse helpers.
 */
import type {
  NotificationChannel,
  NotificationFrequency,
  NotificationRecipientStrategy,
  NotificationTriggerEventKind,
} from "@/db/schema";

export const TRIGGER_EVENT_KIND_LABELS: Record<
  NotificationTriggerEventKind,
  string
> = {
  opportunity_due_soon: "Opportunity due soon",
  opportunity_advanced: "Opportunity advanced a stage",
  opportunity_no_bid: "Opportunity marked no-bid",
  opportunity_won: "Opportunity won",
  opportunity_lost: "Opportunity lost",
  proposal_created: "Proposal created",
  proposal_advanced: "Proposal advanced a stage",
  proposal_section_overdue: "Proposal section overdue",
  review_request_pending: "Color-team review pending",
  review_completed: "Color-team review completed",
  review_assignment_added: "Color-team reviewer added late",
  compliance_overdue: "Compliance item overdue",
  audit_anomaly: "Audit anomaly detected",
  membership_invited: "Team member invited",
  membership_disabled: "Team member disabled",
  comment_mentioned: "Review comment mention",
  opportunity_reviewed: "Opportunity bid/no-bid review submitted",
  solicitation_role_assigned: "Solicitation role assigned",
};

export const RECIPIENT_STRATEGY_LABELS: Record<
  NotificationRecipientStrategy,
  string
> = {
  specific_users: "Specific users",
  role_based: "By role",
  formula: "By relationship to the record",
  mentioned_in_payload: "Users mentioned in the event payload",
};

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: "In-app",
  email: "Email",
  slack: "Slack (coming soon)",
  teams: "Teams (coming soon)",
};

export const FREQUENCY_LABELS: Record<NotificationFrequency, string> = {
  immediate: "Immediate",
  batched_daily: "Daily digest",
  batched_weekly: "Weekly digest",
};

/**
 * The formula recipient strategy supports a fixed set of "relationship
 * to the record" lookups. Each one maps to a concrete user-id resolver
 * implemented in the trigger dispatcher (Phase C).
 */
export const FORMULA_KINDS = [
  "proposal_owner",
  "opportunity_owner",
  "capture_mgr",
  "pricing_lead",
  "section_author",
  "review_assignee",
] as const;
export type FormulaKind = (typeof FORMULA_KINDS)[number];

export const FORMULA_KIND_LABELS: Record<FormulaKind, string> = {
  proposal_owner: "Proposal manager",
  opportunity_owner: "Opportunity owner",
  capture_mgr: "Capture lead",
  pricing_lead: "Pricing lead",
  section_author: "Section author",
  review_assignee: "Color-team review assignees",
};
