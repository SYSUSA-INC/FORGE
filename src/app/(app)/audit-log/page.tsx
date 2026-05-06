import Link from "next/link";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  listAuditActorsAction,
  listAuditEventsAction,
  type AuditFilter,
} from "./actions";
import { AuditLogClient } from "./AuditLogClient";

export const dynamic = "force-dynamic";

function readSearchParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    actor?: string;
    resource?: string;
    from?: string;
    to?: string;
    page?: string;
  };
}) {
  await requireAuth();
  await requireCurrentOrg();

  const filter: AuditFilter = {
    query: readSearchParam(searchParams.q),
    actorUserId: readSearchParam(searchParams.actor),
    resourceType: readSearchParam(searchParams.resource),
    fromDate: readSearchParam(searchParams.from),
    toDate: readSearchParam(searchParams.to),
    page: searchParams.page ? Number(searchParams.page) : 1,
  };

  const [result, actors] = await Promise.all([
    listAuditEventsAction(filter),
    listAuditActorsAction(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Operations Management"
        title="Audit log"
        subtitle="Tenant-scoped record of every mutating action — who did what, to which resource, and when. Filterable by actor, action, resource, time window. Exportable as CSV for compliance reviews."
        actions={
          <Link href="/settings" className="aur-btn aur-btn-ghost">
            Back to settings
          </Link>
        }
        meta={[
          {
            label: "Matches",
            value: String(result.total).padStart(2, "0"),
          },
          {
            label: "Page",
            value: `${result.page}`,
          },
          {
            label: "Page size",
            value: String(result.pageSize),
          },
        ]}
      />

      <Panel title="Audit events" eyebrow={`${result.total} total`}>
        <AuditLogClient
          initialResult={result}
          actors={actors}
          initialFilter={filter}
        />
      </Panel>
    </>
  );
}
