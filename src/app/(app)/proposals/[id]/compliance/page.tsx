import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  complianceItems,
  proposalSections,
  proposals,
  users,
} from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  STATUSES,
  computeCompletion,
} from "@/lib/compliance-types";
import { listProposalTeamCandidates } from "../../actions";
import { ComplianceClient } from "./ComplianceClient";

export const dynamic = "force-dynamic";

export default async function ProposalCompliancePage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [p] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, params.id),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!p) notFound();

  const items = await db
    .select({
      id: complianceItems.id,
      category: complianceItems.category,
      number: complianceItems.number,
      requirementText: complianceItems.requirementText,
      volume: complianceItems.volume,
      rfpPageReference: complianceItems.rfpPageReference,
      proposalSectionId: complianceItems.proposalSectionId,
      proposalPageReference: complianceItems.proposalPageReference,
      status: complianceItems.status,
      notes: complianceItems.notes,
      ordering: complianceItems.ordering,
      ownerUserId: complianceItems.ownerUserId,
      ownerName: users.name,
      ownerEmail: users.email,
      sectionTitle: proposalSections.title,
      sectionOrdering: proposalSections.ordering,
    })
    .from(complianceItems)
    .leftJoin(users, eq(users.id, complianceItems.ownerUserId))
    .leftJoin(
      proposalSections,
      eq(proposalSections.id, complianceItems.proposalSectionId),
    )
    .where(eq(complianceItems.proposalId, params.id))
    .orderBy(asc(complianceItems.ordering));

  const sections = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, params.id))
    .orderBy(asc(proposalSections.ordering));

  const team = await listProposalTeamCandidates();

  const stats = computeCompletion(items.map((i) => ({ status: i.status })));
  const byCategory: Record<string, number> = {};
  for (const i of items) byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Compliance rollup" eyebrow="Section L/M traceability">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Total items"
            value={stats.total}
          />
          <Stat
            label="Complete"
            value={stats.complete}
            color="#10B981"
          />
          <Stat
            label="Partial"
            value={stats.partial}
            color="#F59E0B"
          />
          <Stat
            label="Not addressed"
            value={stats.notAddressed}
            color="#F43F5E"
          />
        </div>
        <div className="mt-4 rounded-full bg-white/5">
          <div
            className="h-2 rounded-full transition-all"
            style={{
              width: `${stats.percent}%`,
              background:
                "linear-gradient(90deg, #F43F5E 0%, #F59E0B 50%, #10B981 100%)",
            }}
          />
        </div>
        <div className="mt-1 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          {stats.percent}% weighted completion ({stats.na} N/A excluded)
        </div>
      </Panel>

      <ComplianceClient
        proposalId={params.id}
        categories={CATEGORIES}
        statuses={STATUSES}
        categoryLabels={CATEGORY_LABELS}
        categoryColors={CATEGORY_COLORS}
        statusLabels={STATUS_LABELS}
        statusColors={STATUS_COLORS}
        sections={sections.map((s) => ({
          id: s.id,
          title: s.title,
          ordering: s.ordering,
        }))}
        team={team}
        byCategory={byCategory}
        items={items.map((i) => ({
          id: i.id,
          category: i.category,
          number: i.number,
          requirementText: i.requirementText,
          volume: i.volume,
          rfpPageReference: i.rfpPageReference,
          proposalSectionId: i.proposalSectionId,
          proposalPageReference: i.proposalPageReference,
          status: i.status,
          notes: i.notes,
          ownerUserId: i.ownerUserId,
          ownerName: i.ownerName,
          ownerEmail: i.ownerEmail,
          sectionTitle: i.sectionTitle ?? null,
          sectionOrdering: i.sectionOrdering ?? null,
        }))}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="aur-card px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </div>
      <div
        className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
