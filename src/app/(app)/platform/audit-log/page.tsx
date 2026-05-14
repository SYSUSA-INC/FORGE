import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { PlatformAuditLogClient } from "./PlatformAuditLogClient";
import {
  listPlatformAuditActorsAction,
  listPlatformAuditEventsAction,
  listPlatformAuditTenantsAction,
  type PlatformAuditFilter,
} from "./actions";

export const dynamic = "force-dynamic";

function readSearchParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function PlatformAuditLogPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    tenant?: string;
    actor?: string;
    resource?: string;
    category?: string;
    from?: string;
    to?: string;
    page?: string;
  };
}) {
  await requireSuperadmin();

  const rawCategory = readSearchParam(searchParams.category);
  const filter: PlatformAuditFilter = {
    query: readSearchParam(searchParams.q),
    organizationId: readSearchParam(searchParams.tenant),
    actorUserId: readSearchParam(searchParams.actor),
    resourceType: readSearchParam(searchParams.resource),
    category:
      rawCategory === "read" || rawCategory === "mutation"
        ? rawCategory
        : undefined,
    fromDate: readSearchParam(searchParams.from),
    toDate: readSearchParam(searchParams.to),
    page: searchParams.page ? Number(searchParams.page) : 1,
  };

  const [result, tenants, actors] = await Promise.all([
    listPlatformAuditEventsAction(filter),
    listPlatformAuditTenantsAction(),
    listPlatformAuditActorsAction(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Platform Administration"
        title="Platform audit log"
        subtitle="Cross-tenant view of every recorded action. Reads from the same audit_log table that powers each tenant's /audit-log, but without the per-org scope filter. Use the tenant filter to focus, or the activity-by-tenant panel below to spot anomalies."
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost">
            Back to admin
          </Link>
        }
        meta={[
          { label: "Tenants seen", value: String(tenants.length).padStart(2, "0") },
          { label: "Matches", value: String(result.total).padStart(2, "0") },
          { label: "Page", value: `${result.page}` },
          { label: "Page size", value: String(result.pageSize) },
        ]}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Events by tenant"
          className="xl:col-span-1"
        >
          {tenants.length === 0 ? (
            <p className="font-mono text-[11px] text-muted">
              No audit rows recorded yet — the table is empty.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tenants.slice(0, 20).map((t) => (
                <li
                  key={t.id}
                  className="flex items-baseline justify-between gap-2 border-b border-white/5 pb-1 last:border-0"
                >
                  <Link
                    href={`/platform/audit-log?tenant=${encodeURIComponent(t.id)}`}
                    className="truncate text-[12px] hover:underline"
                    title={t.slug}
                  >
                    {t.name}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {t.totalEvents.toLocaleString()}
                  </span>
                </li>
              ))}
              {tenants.length > 20 ? (
                <li className="pt-1 font-mono text-[10px] text-subtle">
                  +{tenants.length - 20} more
                </li>
              ) : null}
            </ul>
          )}
        </Panel>

        <Panel title="Events" className="xl:col-span-2">
          <PlatformAuditLogClient
            initialResult={result}
            tenants={tenants.map((t) => ({
              id: t.id,
              name: t.name,
              slug: t.slug,
              totalEvents: t.totalEvents,
            }))}
            actors={actors}
            initialFilter={filter}
          />
        </Panel>
      </div>
    </>
  );
}
