import type { NotificationKind } from "@/db/schema";
import { THEME } from "@/lib/theme-colors";

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  review_assigned: "Review assigned",
  review_section_assigned: "Section review assigned",
  review_comment_mentioned: "Mentioned in comment",
  review_completed: "Review closed",
  opportunity_review_completed: "Opportunity review back",
  solicitation_role_assigned: "Assigned to solicitation",
  solicitation_amended: "Solicitation amended",
  partner_answered: "Partner answered",
  plan_role_assigned: "Named on a plan",
  milestone_due_soon: "Milestone due soon",
  proposal_section_overdue: "Section overdue",
};

export const NOTIFICATION_KIND_ICONS: Record<NotificationKind, string> = {
  review_assigned: "✦",
  review_section_assigned: "❑",
  review_comment_mentioned: "@",
  review_completed: "✓",
  opportunity_review_completed: "✉",
  solicitation_role_assigned: "👥",
  solicitation_amended: "±",
  partner_answered: "✓",
  plan_role_assigned: "👥",
  milestone_due_soon: "◷",
  proposal_section_overdue: "!",
};

export const NOTIFICATION_KIND_COLORS: Record<NotificationKind, string> = {
  review_assigned: THEME.indigo,
  review_section_assigned: THEME.cobalt,
  review_comment_mentioned: THEME.plum,
  review_completed: THEME.green,
  opportunity_review_completed: THEME.cobalt,
  solicitation_role_assigned: THEME.brass,
  // Attention: the solicitation changed under the team.
  solicitation_amended: THEME.brass,
  // Done: the partner's answers are in.
  partner_answered: THEME.green,
  // In progress: a duty on the plan.
  plan_role_assigned: THEME.cobalt,
  // Attention: a milestone you own is close.
  milestone_due_soon: THEME.brass,
  // Blocked: a part past its date with nothing written.
  proposal_section_overdue: THEME.red,
};
