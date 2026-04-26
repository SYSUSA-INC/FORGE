import type { NotificationKind } from "@/db/schema";

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  review_assigned: "Review assigned",
  review_section_assigned: "Section review assigned",
  review_comment_mentioned: "Mentioned in comment",
  review_completed: "Review closed",
};

export const NOTIFICATION_KIND_ICONS: Record<NotificationKind, string> = {
  review_assigned: "✦",
  review_section_assigned: "❑",
  review_comment_mentioned: "@",
  review_completed: "✓",
};

export const NOTIFICATION_KIND_COLORS: Record<NotificationKind, string> = {
  review_assigned: "#A78BFA",
  review_section_assigned: "#2DD4BF",
  review_comment_mentioned: "#EC4899",
  review_completed: "#10B981",
};
