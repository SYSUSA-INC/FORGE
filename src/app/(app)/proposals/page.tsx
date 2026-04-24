import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, proposals, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { STAGE_COLORS, STAGE_LABELS } from "@/lib/proposal-types";
import { ProposalsClient } from "./ProposalsClient";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      stage: proposals.stage,
      oppId: opportunities.id,
      oppTitle: opportunities.title,
      oppAgency: opportunities.agency,
      oppSolicitation: opportunities.solicitationNumber,
      pmUserId: proposals.proposalManagerUserId,
      pmName: users.name,
      pmEmail: users.email,
      dueDate: opportunities.responseDueDate,
      submittedAt: proposals.submittedAt,
      updatedAt: proposals.updatedAt,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .leftJoin(users, eq(users.id, proposals.proposalManagerUserId))
    .where(eq(proposals.organizationId, organizationId))
    .orderBy(desc(proposals.updatedAt));

  if (rows.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Proposals"
          title="Proposals"
          subtitle="Manage proposals through Pink → Red → Gold → White Gloves reviews."
          actions={
            <Link href="/proposals/new" className="aur-btn aur-btn-primary">
              + New proposal
            </Link>
          }
        />
        <Panel title="No proposals yet">
          <p className="text-sm text-muted">
            Start a proposal by linking it to an opportunity. Each new proposal
            comes with six default sections (Executive Summary, Technical,
            Management, Past Performance, Pricing, Compliance).
          </p>
          <div className="mt-4">
            <Link
              href="/proposals/new"
              className="aur-btn aur-btn-primary"
            >
              Create proposal
            </Link>
          </div>
        </Panel>
      </>
    );
  }

  const stageCounts: Record<string, number> = {};
  for (const r of rows) stageCounts[r.stage] = (stageCounts[r.stage] ?? 0) + 1;

  return (
    <ProposalsClient
      stageCounts={stageCounts}
      proposals={rows.map((r) => ({
        id: r.id,
        title: r.title,
        stage: r.stage,
        stageLabel: STAGE_LABELS[r.stage],
        stageColor: STAGE_COLORS[r.stage],
        oppId: r.oppId,
        oppTitle: r.oppTitle,
        oppAgency: r.oppAgency,
        oppSolicitation: r.oppSolicitation,
        pmName: r.pmName,
        pmEmail: r.pmEmail,
        dueDate: r.dueDate ? r.dueDate.toISOString() : null,
        submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
        updatedAt: r.updatedAt.toISOString(),
      }))}
    />
  );
}
