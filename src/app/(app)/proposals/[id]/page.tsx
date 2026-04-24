import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { proposalSections, proposals } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import { SECTION_STATUS_COLORS, SECTION_STATUS_LABELS } from "@/lib/proposal-types";
import { ProposalOverviewForm } from "./ProposalOverviewForm";
import { StageAdvancePanel } from "./StageAdvancePanel";
import { listProposalTeamCandidates } from "../actions";

export const dynamic = "force-dynamic";

export default async function ProposalOverviewPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [p] = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.id, params.id),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!p) notFound();

  const sections = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      status: proposalSections.status,
      wordCount: proposalSections.wordCount,
      pageLimit: proposalSections.pageLimit,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, params.id));

  const team = await listProposalTeamCandidates();
  const totalWords = sections.reduce((a, s) => a + s.wordCount, 0);
  const approved = sections.filter((s) => s.status === "approved").length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Panel title="Proposal details">
          <ProposalOverviewForm
            proposalId={p.id}
            initial={{
              title: p.title,
              notes: p.notes,
              proposalManagerUserId: p.proposalManagerUserId,
              captureManagerUserId: p.captureManagerUserId,
              pricingLeadUserId: p.pricingLeadUserId,
            }}
            team={team}
          />
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <StageAdvancePanel proposalId={p.id} currentStage={p.stage} />

        <Panel title="Sections" eyebrow={`${approved}/${sections.length} approved · ${totalWords} words`}>
          <ul className="flex flex-col gap-1.5">
            {sections.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span className="truncate font-mono text-[12px] text-text">
                  {s.title}
                </span>
                <span
                  className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                  style={{
                    color: SECTION_STATUS_COLORS[s.status],
                    backgroundColor: `${SECTION_STATUS_COLORS[s.status]}1A`,
                    border: `1px solid ${SECTION_STATUS_COLORS[s.status]}40`,
                  }}
                >
                  {SECTION_STATUS_LABELS[s.status]}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
