import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import {
  auditLogs,
  notificationDeliveries,
  organizations,
  productionErrors,
  users,
} from "@/db/schema";
import { recordRead } from "@/lib/audit-log";
import { requireSuperadmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * BL-15 Phase B-3a — tenant activity + health view.
 *
 * Operator triage surface. Superadmin lands here to answer "what's
 * been happening in this tenant lately?" without leaving the admin
 * portal. Read-only — no actions live on this page. Lifecycle actions
 * stay on `/admin/orgs/[id]`.
 *
 * Two panels:
 *   1. Recent activity — last 50 audit-log rows for this tenant,
 *      action + actor + resource + timestamp.
 *   2. Health — last-7-day action counts, unresolved production_error
 *      count, latest sign-in timestamp, recent notification delivery
 *      health (succeeded vs errored). Each metric links to the
 *      relevant detail view where one exists.
 *
 * Reading this page is itself a cross-tenant operation, so
 * `recordRead` writes an audit row into the target tenant's log.
 */
export default async function TenantActivityPage({
  params,
}: {
  params: { id: string };
}) {
  const actor = await requireSuperadmin();

  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      disabledAt: organizations.disabledAt,
    })
    .from(organizations)
    .where(eq(organizations.id, params.id))
    .limit(1);

  if (!org) notFound();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    recentActivity,
    actionCount7dRow,
    actorCount7dRow,
    unresolvedErrorRow,
    latestUserActivityRow,
    deliverySuccessRow,
    deliveryErrorRow,
  ] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorEmail: auditLogs.actorEmailSnapshot,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, org.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50),
    db
      .select({ n: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          gte(auditLogs.createdAt, sevenDaysAgo),
        ),
      ),
    db
      .select({ n: sql<number>`count(distinct ${auditLogs.actorEmailSnapshot})` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          gte(auditLogs.createdAt, sevenDaysAgo),
          sql`${auditLogs.actorEmailSnapshot} <> ''`,
        ),
      ),
    db
      .select({ n: count() })
      .from(productionErrors)
      .where(
        and(
          eq(productionErrors.organizationId, org.id),
          isNull(productionErrors.resolvedAt),
        ),
      ),
    db
      .select({ at: sql<Date>`max(${auditLogs.createdAt})` })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, org.id)),
    db
      .select({ n: count() })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.organizationId, org.id),
          gte(notificationDeliveries.createdAt, sevenDaysAgo),
          eq(notificationDeliveries.error, ""),
        ),
      ),
    db
      .select({ n: count() })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.organizationId, org.id),
          gte(notificationDeliveries.createdAt, sevenDaysAgo),
          sql`${notificationDeliveries.error} <> ''`,
        ),
      ),
  ]);

  // Resolve unique actor emails → user names for the activity table.
  const actorEmails = Array.from(
    new Set(
      recentActivity
        .map((r) => r.actorEmail)
        .filter((e): e is string => Boolean(e)),
    ),
  );
  const userRows = actorEmails.length
    ? await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(sql`${users.email} = ANY(${actorEmails})`)
    : [];
  const nameByEmail = new Map(
    userRows
      .filter((u): u is { email: string; name: string | null } => !!u.email)
      .map((u) => [u.email, u.name ?? ""]),
  );

  const actionCount7d = Number(actionCount7dRow[0]?.n ?? 0);
  const actorCount7d = Number(actorCount7dRow[0]?.n ?? 0);
  const unresolvedErrorCount = Number(unresolvedErrorRow[0]?.n ?? 0);
  const latestActivityAt = latestUserActivityRow[0]?.at ?? null;
  const deliveriesOk = Number(deliverySuccessRow[0]?.n ?? 0);
  const deliveriesErrored = Number(deliveryErrorRow[0]?.n ?? 0);

  await recordRead({
    organizationId: org.id,
    actor: { userId: actor.id, email: actor.email },
    action: "tenant.view_activity",
    resourceType: "organization",
    resourceId: org.id,
    metadata: {
      actionCount7d,
      actorCount7d,
      unresolvedErrorCount,
    },
  });

  return (
    <>
      <PageHeader
        eyebrow={`Tenant activity · ${org.slug}`}
        title={`${org.name} — recent activity`}
        subtitle="Read-only operator-triage view. What's been happening in this tenant, and where to look first if something's off."
        actions={
          <>
            <Link
              href={`/admin/orgs/${org.id}`}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              ← Tenant detail
            </Link>
            <Link
              href={`/platform/audit-log?orgId=${org.id}`}
              className="aur-btn aur-btn-ghost text-[11px]"
              title="Full audit log filtered to this tenant"
            >
              Full audit log →
            </Link>
          </>
        }
        meta={[
          {
            label: "Actions (7d)",
            value: String(actionCount7d),
            accent: actionCount7d === 0 ? "rose" : "emerald",
          },
          {
            label: "Unique actors (7d)",
            value: String(actorCount7d),
          },
          {
            label: "Unresolved errors",
            value: String(unresolvedErrorCount),
            accent: unresolvedErrorCount > 0 ? "rose" : "emerald",
          },
          {
            label: "Last activity",
            value: latestActivityAt
              ? relativeTime(new Date(latestActivityAt))
              : "Never",
            accent:
              !latestActivityAt ||
              Date.now() - new Date(latestActivityAt).getTime() >
                7 * 24 * 60 * 60 * 1000
                ? "rose"
                : "emerald",
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel
          title="Recent activity"
          eyebrow={`Latest ${recentActivity.length}`}
        >
          {recentActivity.length === 0 ? (
            <p className="font-mono text-[11px] text-muted">
              No audit-log entries for this tenant yet.
            </p>
          ) : (
            <ul className="flex flex-col font-mono text-[11px]">
              {recentActivity.map((r) => {
                const name = nameByEmail.get(r.actorEmail) || r.actorEmail || "—";
                return (
                  <li
                    key={r.id}
                    className="grid grid-cols-[120px_1fr_1fr_140px] gap-3 border-b border-white/5 px-2 py-1.5 last:border-0"
                  >
                    <span className="tabular-nums text-muted">
                      {formatTimestamp(new Date(r.createdAt))}
                    </span>
                    <span className="truncate text-text">{r.action}</span>
                    <span className="truncate text-muted">
                      {name}
                      {r.resourceType ? ` · ${r.resourceType}` : ""}
                      {r.resourceId ? ` ${r.resourceId.slice(0, 8)}…` : ""}
                    </span>
                    <span className="tabular-nums text-muted/70">
                      {relativeTime(new Date(r.createdAt))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Health">
          <dl className="grid grid-cols-1 gap-3 font-mono text-[12px]">
            <HealthRow
              label="Unresolved errors"
              value={String(unresolvedErrorCount)}
              tone={unresolvedErrorCount > 0 ? "rose" : "emerald"}
              link={
                unresolvedErrorCount > 0
                  ? { href: `/admin/errors`, text: "Triage →" }
                  : undefined
              }
              hint="From the in-app production_error log (BL-QC-errors)"
            />
            <HealthRow
              label="Last activity"
              value={
                latestActivityAt
                  ? formatTimestamp(new Date(latestActivityAt))
                  : "Never"
              }
              tone={
                latestActivityAt &&
                Date.now() - new Date(latestActivityAt).getTime() <
                  7 * 24 * 60 * 60 * 1000
                  ? "emerald"
                  : "rose"
              }
              hint="Most recent audit-log row across all users"
            />
            <HealthRow
              label="Notifications (7d, OK)"
              value={String(deliveriesOk)}
              tone={deliveriesOk > 0 ? "emerald" : undefined}
              hint="notification_delivery rows with no error"
            />
            <HealthRow
              label="Notifications (7d, errored)"
              value={String(deliveriesErrored)}
              tone={deliveriesErrored > 0 ? "rose" : "emerald"}
              hint={
                deliveriesErrored > 0
                  ? "Investigate via the full audit log"
                  : "All notification deliveries succeeded"
              }
            />
          </dl>

          {org.disabledAt ? (
            <div className="mt-4 rounded-md border border-rose/40 bg-rose/[0.06] px-3 py-2 font-mono text-[11px] text-rose">
              Tenant is currently disabled. Existing sessions still resolve;
              new sign-ins are blocked.
            </div>
          ) : null}
        </Panel>
      </div>
    </>
  );
}

function HealthRow({
  label,
  value,
  tone,
  link,
  hint,
}: {
  label: string;
  value: string;
  tone?: "rose" | "emerald";
  link?: { href: string; text: string };
  hint?: string;
}) {
  const toneClass =
    tone === "rose"
      ? "text-rose"
      : tone === "emerald"
        ? "text-emerald-300"
        : "text-text";
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted">{label}</span>
        <span className={`tabular-nums font-semibold ${toneClass}`}>
          {value}
        </span>
      </div>
      {hint ? (
        <div className="mt-1 font-mono text-[10px] text-muted/70">{hint}</div>
      ) : null}
      {link ? (
        <div className="mt-2 font-mono text-[10px]">
          <Link
            href={link.href}
            className="text-violet underline-offset-2 hover:underline"
          >
            {link.text}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function formatTimestamp(d: Date): string {
  // YYYY-MM-DD HH:MM format, no seconds. UTC.
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function relativeTime(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
