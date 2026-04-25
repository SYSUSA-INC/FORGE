import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listMyNotificationsAction } from "./actions";
import { NotificationsClient } from "./NotificationsClient";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireAuth();
  await requireCurrentOrg();

  const rows = await listMyNotificationsAction({ limit: 100 });
  const unreadCount = rows.filter((r) => !r.readAt).length;

  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        subtitle="Reviews you're assigned to, comments where you're tagged, and reviews that have been closed."
        meta={[
          { label: "Total", value: String(rows.length) },
          {
            label: "Unread",
            value: String(unreadCount),
            accent: unreadCount > 0 ? "magenta" : undefined,
          },
        ]}
      />
      <NotificationsClient initial={rows} />
    </>
  );
}
