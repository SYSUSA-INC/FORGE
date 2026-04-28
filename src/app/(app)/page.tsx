import Link from "next/link";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalReviews,
  proposals,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { STAGE_LABELS as OPP_STAGE_LABELS } from "@/lib/opportunity-types";
import { STAGE_LABELS as PROP_STAGE_LABELS } from "@/lib/proposal-types";

export const dynamic = "force-dynamic";

const ACTIVE_OPP_STAGES = [
  "identified",
  "sources_sought",
  "qualification",
  "capture",
  "pre_proposal",
  "writing",
  "submitted",
];

const ACTIVE_PROPOSAL_STAGES = [
  "draft",
  "pink",
  "red",
  "gold",
  "white_gloves",
  "submitted",
];

export default async function DashboardPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const now = new Date();

  const [oppRows, propRows, reviewRows] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        agency: opportunities.agency,
        stage: opportunities.stage,
        responseDueDate: opportunities.responseDueDate,
        pWin: opportunities.pWin,
      })
      .from(opportunities)
      .where(eq(opportunities.organizationId, organizationId)),
    db
      .select({
        id: proposals.id,
        title: proposals.title,
        stage: proposals.stage,
        updatedAt: proposals.updatedAt,
      })
      .from(proposals)
      .where(eq(proposals.organizationId, organizationId)),
    db
      .select({ id: proposalReviews.id })
      .from(proposalReviews)
      .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
      .where(
        and(
          eq(proposals.organizationId, organizationId),
          eq(proposalReviews.status, "in_progress"),
        ),
      ),
  ]);

  const activeOpps = oppRows.filter((o) =>
    ACTIVE_OPP_STAGES.includes(o.stage),
  );
  const activeProposals = propRows.filter((p) =>
    ACTIVE_PROPOSAL_STAGES.includes(p.stage),
  );

  // Most-pressing opportunity: smallest positive days-to-due.
  const upcoming = activeOpps
    .filter((o) => o.responseDueDate && o.responseDueDate.getTime() >= now.getTime())
    .sort(
      (a, b) =>
        (a.responseDueDate?.getTime() ?? 0) -
        (b.responseDueDate?.getTime() ?? 0),
    );
  const nextDue = upcoming[0] ?? null;
  const nextDueDays = nextDue?.responseDueDate
    ? Math.max(
        0,
        Math.ceil(
          (nextDue.responseDueDate.getTime() - now.getTime()) /
            (24 * 60 * 60_000),
        ),
      )
    : null;

  // Counts by stage
  const oppByStage: Record<string, number> = {};
  for (const o of activeOpps) {
    const k = OPP_STAGE_LABELS[o.stage as keyof typeof OPP_STAGE_LABELS] ?? o.stage;
    oppByStage[k] = (oppByStage[k] ?? 0) + 1;
  }
  const propByStage: Record<string, number> = {};
  for (const p of activeProposals) {
    const k =
      PROP_STAGE_LABELS[p.stage as keyof typeof PROP_STAGE_LABELS] ?? p.stage;
    propByStage[k] = (propByStage[k] ?? 0) + 1;
  }

  const recentProposals = [...propRows]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="Command"
        title="Command"
        subtitle="Live snapshot of your active pursuits, proposals in flight, and the next deadline coming up."
        actions={
          <>
            <Link href="/opportunities/new" className="aur-btn">
              New opportunity
            </Link>
            <Link href="/proposals/new" className="aur-btn aur-btn-primary">
              New proposal
            </Link>
          </>
        }
        meta={[
          {
            label: "Active opportunities",
            value: String(activeOpps.length).padStart(2, "0"),
          },
          {
            label: "Active proposals",
            value: String(activeProposals.length).padStart(2, "0"),
          },
          {
            label: "In review",
            value: String(reviewRows.length).padStart(2, "0"),
            accent: reviewRows.length > 0 ? "magenta" : undefined,
          },
          {
            label: "Next deadline",
            value: nextDueDays === null ? "—" : `${nextDueDays}d`,
            accent: nextDueDays !== null && nextDueDays <= 7 ? "rose" : undefined,
          },
        ]}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        {nextDue ? (
          <Panel
            title="Next deadline"
            eyebrow={`${nextDueDays} day${nextDueDays === 1 ? "" : "s"} remaining`}
            actions={
              <Link
                href={`/opportunities/${nextDue.id}`}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Open opportunity
              </Link>
            }
          >
            <div className="font-display text-2xl font-semibold text-text">
              {nextDue.title}
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
              {nextDue.agency || "—"}{" "}
              {nextDue.responseDueDate ? (
                <span className="text-subtle">
                  · due {nextDue.responseDueDate.toISOString().slice(0, 10)}
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px]">
                Stage:{" "}
                <span className="text-text">
                  {OPP_STAGE_LABELS[nextDue.stage as keyof typeof OPP_STAGE_LABELS] ?? nextDue.stage}
                </span>
              </span>
              {nextDue.pWin > 0 ? (
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px]">
                  PWin: <span className="text-text">{nextDue.pWin}%</span>
                </span>
              ) : null}
            </div>
          </Panel>
        ) : (
          <Panel title="Next deadline" eyebrow="Nothing imminent">
            <p className="font-body text-[13px] leading-relaxed text-muted">
              No active opportunities have a future due date. Add one in{" "}
              <Link href="/opportunities/new" className="text-teal underline">
                Opportunities
              </Link>
              , or pull from{" "}
              <Link
                href="/opportunities/import"
                className="text-teal underline"
              >
                SAM.gov
              </Link>
              .
            </p>
          </Panel>
        )}

        <Panel title="By stage" eyebrow="Active opportunities">
          {activeOpps.length === 0 ? (
            <p className="font-body text-[13px] text-muted">
              No active opportunities.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {Object.entries(oppByStage).map(([stage, count]) => (
                <li
                  key={stage}
                  className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5"
                >
                  <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
                    {stage}
                  </span>
                  <span className="font-display tabular-nums text-text">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Recent proposals"
          eyebrow="Most recently updated"
          actions={
            <Link
              href="/proposals"
              className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
            >
              View all →
            </Link>
          }
        >
          {recentProposals.length === 0 ? (
            <p className="font-body text-[13px] text-muted">
              No proposals yet.{" "}
              <Link
                href="/proposals/new"
                className="text-teal underline"
              >
                Create one
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {recentProposals.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/proposals/${p.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 hover:border-white/20"
                  >
                    <span className="min-w-0 truncate font-display text-[14px] text-text">
                      {p.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                      <span>
                        {PROP_STAGE_LABELS[
                          p.stage as keyof typeof PROP_STAGE_LABELS
                        ] ?? p.stage}
                      </span>
                      <span className="text-subtle">
                        {p.updatedAt.toISOString().slice(0, 10)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Proposal stages" eyebrow={`${activeProposals.length} active`}>
          {activeProposals.length === 0 ? (
            <p className="font-body text-[13px] text-muted">
              No active proposals.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {Object.entries(propByStage).map(([stage, count]) => (
                <li
                  key={stage}
                  className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5"
                >
                  <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
                    {stage}
                  </span>
                  <span className="font-display tabular-nums text-text">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section>
        <Panel title="Quick links">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Link
              href="/opportunities/import"
              className="aur-card px-3 py-3 text-center transition-colors hover:border-white/20"
            >
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                SAM.gov
              </div>
              <div className="mt-1 font-display text-[13px] text-text">
                Import opportunities
              </div>
            </Link>
            <Link
              href="/proposals"
              className="aur-card px-3 py-3 text-center transition-colors hover:border-white/20"
            >
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                Proposals
              </div>
              <div className="mt-1 font-display text-[13px] text-text">
                Browse pipeline
              </div>
            </Link>
            <Link
              href="/intelligence"
              className="aur-card px-3 py-3 text-center transition-colors hover:border-white/20"
            >
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                Intelligence
              </div>
              <div className="mt-1 font-display text-[13px] text-text">
                AI brief + insights
              </div>
            </Link>
            <Link
              href="/notifications"
              className="aur-card px-3 py-3 text-center transition-colors hover:border-white/20"
            >
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                Inbox
              </div>
              <div className="mt-1 font-display text-[13px] text-text">
                Notifications
              </div>
            </Link>
          </div>
        </Panel>
      </section>
    </>
  );
}
