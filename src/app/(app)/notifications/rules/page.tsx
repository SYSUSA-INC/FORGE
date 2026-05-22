import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { notificationRules, users } from "@/db/schema";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  CHANNEL_LABELS,
  FREQUENCY_LABELS,
  RECIPIENT_STRATEGY_LABELS,
  TRIGGER_EVENT_KIND_LABELS,
} from "@/lib/notification-rules-types";

export const dynamic = "force-dynamic";

export default async function NotificationRulesPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  // Admin-gated — nav visibility is defense in depth, not the gate.
  // Non-admin browsing directly to /notifications/rules redirects to "/"
  // and an auth_denied row lands in the audit log (BL-20).
  await requireOrgAdmin(organizationId);

  const rows = await db
    .select({
      id: notificationRules.id,
      name: notificationRules.name,
      description: notificationRules.description,
      triggerEventKind: notificationRules.triggerEventKind,
      recipientStrategy: notificationRules.recipientStrategy,
      channels: notificationRules.channels,
      frequency: notificationRules.frequency,
      slaSeconds: notificationRules.slaSeconds,
      active: notificationRules.active,
      createdAt: notificationRules.createdAt,
      updatedAt: notificationRules.updatedAt,
      createdByName: users.name,
      createdByEmail: users.email,
    })
    .from(notificationRules)
    .leftJoin(users, eq(users.id, notificationRules.createdByUserId))
    .where(eq(notificationRules.organizationId, organizationId))
    .orderBy(
      desc(notificationRules.active),
      asc(notificationRules.name),
    );

  // Just a status snapshot for the page header — total + active count.
  const total = rows.length;
  const activeCount = rows.filter((r) => r.active).length;

  // `and` is imported for forward compatibility with Phase B (rule
  // filtering); silence lint without dropping the import.
  void and;

  return (
    <>
      <PageHeader
        eyebrow="Operations Management"
        title="Notification rules"
        subtitle="Configure who gets notified about which events, on which channels, with what SLA. Rules apply across the whole org; per-user mute settings live under each user's profile."
        actions={
          <Link
            href="/notifications/rules/new"
            className="aur-btn aur-btn-primary"
          >
            + New rule
          </Link>
        }
        meta={[
          { label: "Total rules", value: String(total).padStart(2, "0") },
          {
            label: "Active",
            value: String(activeCount).padStart(2, "0"),
            accent: activeCount > 0 ? "emerald" : undefined,
          },
        ]}
      />

      {rows.length === 0 ? (
        <Panel title="No rules yet">
          <div className="flex flex-col gap-3">
            <p className="font-body text-[13px] text-muted">
              You don&apos;t have any notification rules configured. Create
              one to start routing events to the right people.
            </p>
            <p className="font-body text-[12px] text-muted">
              A rule binds a <span className="text-text">trigger event</span>{" "}
              (e.g. &quot;opportunity due soon&quot;) to a{" "}
              <span className="text-text">recipient strategy</span> (specific
              users, by role, or by relationship to the record), one or more{" "}
              <span className="text-text">channels</span> (in-app, email),
              and an optional{" "}
              <span className="text-text">SLA + escalation path</span> if the
              first recipient doesn&apos;t acknowledge in time.
            </p>
            <Link
              href="/notifications/rules/new"
              className="aur-btn aur-btn-primary self-start"
            >
              Create your first rule
            </Link>
          </div>
        </Panel>
      ) : (
        <Panel title="Rules" eyebrow={`${activeCount} active of ${total}`}>
          <div className="overflow-x-auto rounded-md border border-white/10 bg-white/[0.02]">
            <table className="w-full min-w-[800px] text-left">
              <thead className="border-b border-white/10 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                <tr>
                  <th className="px-3 py-2 font-normal">Name</th>
                  <th className="px-3 py-2 font-normal">Trigger</th>
                  <th className="px-3 py-2 font-normal">Recipients</th>
                  <th className="px-3 py-2 font-normal">Channels</th>
                  <th className="px-3 py-2 font-normal">Frequency</th>
                  <th className="px-3 py-2 font-normal">SLA</th>
                  <th className="px-3 py-2 font-normal">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-white/5 last:border-0"
                  >
                    <td className="px-3 py-2 font-display text-[12px] text-text">
                      <Link
                        href={`/notifications/rules/${r.id}`}
                        className="hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.description ? (
                        <div className="font-mono text-[10px] text-subtle">
                          {r.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted">
                      {TRIGGER_EVENT_KIND_LABELS[r.triggerEventKind]}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted">
                      {RECIPIENT_STRATEGY_LABELS[r.recipientStrategy]}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted">
                      {r.channels
                        .map((c) => CHANNEL_LABELS[c])
                        .join(", ")}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted">
                      {FREQUENCY_LABELS[r.frequency]}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted">
                      {r.slaSeconds
                        ? `${Math.round(r.slaSeconds / 3600)}h`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                          r.active
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                            : "border-white/10 bg-white/5 text-muted"
                        }`}
                      >
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
