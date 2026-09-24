import type { NotificationKind } from "@/db/schema";
import { THEME } from "@/lib/theme-colors";

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  review_assigned: "Review assigned",
  review_section_assigned: "Section review assigned",
  review_comment_mentioned: "Mentioned in comment",
  review_completed: "Review closed",
  opportunity_review_completed: "Opportunity review back",
  solicitation_role_assigned: "Assigned to solicitation",
};

export const NOTIFICATION_KIND_ICONS: Record<NotificationKind, string> = {
  review_assigned: "✦",
  review_section_assigned: "❑",
  review_comment_mentioned: "@",
  review_completed: "✓",
  opportunity_review_completed: "✉",
  solicitation_role_assigned: "👥",
};

export const NOTIFICATION_KIND_COLORS: Record<NotificationKind, string> = {
  review_assigned: THEME.indigo,
  review_section_assigned: THEME.cobalt,
  review_comment_mentioned: THEME.plum,
  review_completed: THEME.green,
  opportunity_review_completed: THEME.cobalt,
  solicitation_role_assigned: THEME.brass,
};
