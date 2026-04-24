import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { opportunities, proposals, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { STAGE_COLORS, STAGE_LABELS } from "@/lib/proposal-types";
import { ProposalTabs } from "./ProposalTabs";
import { DeleteProposalButton } from "./DeleteProposalButton";

export const dynamic = "force-dynamic";

export default async function ProposalDetailLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      p: proposals,
      oppId: opportunities.id,
      oppTitle: opportunities.title,
      oppAgency: opportunities.agency,
      oppDue: opportunities.responseDueDate,
      pmName: users.name,
      pmEmail: users.email,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .leftJoin(users, eq(users.id, proposals.proposalManagerUserId))
    .where(
      and(
        eq(proposals.id, params.id),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) notFound();
  const { p } = row;
  const stageColor = STAGE_COLORS[p.stage];
  const stageLabel = STAGE_LABELS[p.stage];

  return (
    <>
      <PageHeader
        eyebrow="Proposal"
        title={p.title}
        subtitle={`Linked opportunity: ${row.oppTitle}${row.oppAgency ? ` · ${row.oppAgency}` : ""}`}
        actions={
          <>
            <Link
              href={`/opportunities/${row.oppId}`}
              className="aur-btn aur-btn-ghost"
            >
              View opportunity
            </Link>
            <Link href="/proposals" className="aur-btn aur-btn-ghost">
              Back
            </Link>
            <DeleteProposalButton id={p.id} title={p.title} />
          </>
        }
        meta={[
          { label: "Stage", value: stageLabel },
          {
            label: "Due",
            value: row.oppDue
              ? row.oppDue.toISOString().slice(0, 10)
              : "—",
          },
          {
            label: "Manager",
            value: row.pmName ?? row.pmEmail ?? "Unassigned",
          },
          {
            label: "Submitted",
            value: p.submittedAt
              ? p.submittedAt.toISOString().slice(0, 10)
              : "—",
            accent: p.submittedAt ? "emerald" : undefined,
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: stageColor }}
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          Current stage
        </div>
        <div
          className="rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.22em]"
          style={{
            color: stageColor,
            backgroundColor: `${stageColor}1A`,
            border: `1px solid ${stageColor}40`,
          }}
        >
          {stageLabel}
        </div>
      </div>

      <ProposalTabs id={p.id} />

      {children}
    </>
  );
}
