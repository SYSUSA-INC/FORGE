import Link from "next/link";
import { getMyUnreadCount, listMyNotificationsAction } from "@/app/(app)/notifications/actions";
import { NotificationBellClient } from "./NotificationBellClient";

export async function NotificationBell() {
  let unread = 0;
  let recent: Awaited<ReturnType<typeof listMyNotificationsAction>> = [];
  try {
    unread = await getMyUnreadCount();
    recent = await listMyNotificationsAction({ limit: 5 });
  } catch {
    // No org context yet (e.g., onboarding). Render empty bell.
    return (
      <Link
        href="/notifications"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-muted transition-colors hover:border-white/20 hover:text-text"
        aria-label="Notifications"
      >
        <BellIcon />
      </Link>
    );
  }

  return <NotificationBellClient unread={unread} recent={recent} />;
}

export function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}
