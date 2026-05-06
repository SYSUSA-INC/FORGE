import Link from "next/link";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  listOrgUsersAction,
  listRulesAction,
} from "./actions";
import { NotificationRulesClient } from "./NotificationRulesClient";

export const dynamic = "force-dynamic";

export default async function NotificationRulesPage() {
  const user = await requireAuth();
  await requireCurrentOrg();

  const [rules, orgUsers] = await Promise.all([
    listRulesAction(),
    listOrgUsersAction(),
  ]);

  const isAdmin = user.role === "admin" || user.isSuperadmin;

  const activeCount = rules.filter((r) => r.active).length;
  const inactiveCount = rules.filter((r) => !r.active).length;

  return (
    <>
      <PageHeader
        eyebrow="Operations Management"
        title="Notification rules"
        subtitle="Configure who gets notified when, on which channels, and with what SLA. Existing in-app notifications keep working; rules add a tenant-controllable layer on top."
        actions={
          <Link href="/notifications" className="aur-btn aur-btn-ghost">
            ← Back to notifications
          </Link>
        }
        meta={[
          {
            label: "Active rules",
            value: String(activeCount).padStart(2, "0"),
            accent: activeCount > 0 ? "emerald" : undefined,
          },
          {
            label: "Inactive",
            value: String(inactiveCount).padStart(2, "0"),
          },
          {
            label: "Total",
            value: String(rules.length).padStart(2, "0"),
          },
        ]}
      />
      <NotificationRulesClient
        initialRules={rules}
        orgUsers={orgUsers}
        canEdit={isAdmin}
      />
    </>
  );
}
