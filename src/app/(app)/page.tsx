import Link from "next/link";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getOrganizationSnapshot } from "@/lib/org-snapshot";
import { STAGES, STAGE_LABELS as OPP_STAGE_LABELS } from "@/lib/opportunity-types";
import { STAGE_LABELS as PROP_STAGE_LABELS } from "@/lib/proposal-types";
import { CommandCenterStageGrid } from "./CommandCenterStageGrid";

export const dynamic = "force-dynamic";

/**
 * The Command Center reads from the same `getOrganizationSnapshot()`
 * helper that drives `/opportunities` so the numbers always match
 * (BL-7 spec: "data has to sync across"). Tile widgets here mirror
 * the dashboard exactly, but click navigates rather than filters —
 * the dashboard is where you go to drill in.
 */
export default async function DashboardPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const snap = await getOrganizationSnapshot(organizationId);

  const totalActiveOpps = STAGES.filter(
    (s) => s.phase !== "closed",
  ).reduce((sum, s) => sum + (snap.oppStageStats[s.key]?.count ?? 0), 0);
  const activeProposals = snap.activeProposalRows.length;
  const recentProposals = snap.activeProposalRows.slice(0, 5);

  // Derived counts for the proposal-stage panel — same shape the page
  // had before, computed from the snapshot's already-active list.
  const propByStage: Record<string, number> = {};
  for (const p of snap.activeProposalRows) {
    const k =
      PROP_STAGE_LABELS[p.stage as keyof typeof PROP_STAGE_LABELS] ?? p.stage;
    propByStage[k] = (propByStage[k] ?? 0) + 1;
  }

  return (
    <>
      <PageHeader
        eyebrow="Command"
        title="Command Center"
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
            value: String(totalActiveOpps).padStart(2, "0"),
          },
          {
            label: "Active proposals",
            value: String(activeProposals).padStart(2, "0"),
          },
          {
            label: "In review",
            value: String(snap.proposalsInReview).padStart(2, "0"),
            accent: snap.proposalsInReview > 0 ? "magenta" : undefined,
          },
          {
            label: "Next deadline",
            value: snap.nextDue ? `${snap.nextDue.daysToDue}d` : "—",
            accent:
              snap.nextDue && snap.nextDue.daysToDue <= 7 ? "rose" : undefined,
          },
        ]}
      />

      {/* Stage widget grid — same data + visuals as /opportunities so
          the two pages can never disagree. Click a tile to drill into
          the dashboard already filtered to that stage. */}
      <section className="mb-6">
        <CommandCenterStageGrid stageStats={snap.oppStageStats} />
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        {snap.nextDue ? (
          <Panel
            title="Next deadline"
            eyebrow={`${snap.nextDue.daysToDue} day${
              snap.nextDue.daysToDue === 1 ? "" : "s"
            } remaining`}
            actions={
              <Link
                href={`/opportunities/${snap.nextDue.id}`}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Open opportunity
              </Link>
            }
          >
            <div className="font-display text-2xl font-semibold text-text">
              {snap.nextDue.title}
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
              {snap.nextDue.agency || "—"}{" "}
              <span className="text-subtle">
                · due {snap.nextDue.responseDueDate.toISOString().slice(0, 10)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px]">
                Stage:{" "}
                <span className="text-text">
                  {OPP_STAGE_LABELS[snap.nextDue.stage]}
                </span>
              </span>
              {snap.nextDue.pWin > 0 ? (
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px]">
                  PWin: <span className="text-text">{snap.nextDue.pWin}%</span>
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

        <Panel
          title="Proposal stages"
          eyebrow={`${activeProposals} active`}
        >
          {activeProposals === 0 ? (
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

        <Panel title="Quick links">
          <div className="flex flex-col gap-2">
            <Link
              href="/opportunities"
              className="aur-card flex items-center justify-between px-3 py-2.5 transition-colors hover:border-white/20"
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                  Drill in
                </div>
                <div className="mt-0.5 font-display text-[13px] text-text">
                  Open Opportunities Dashboard
                </div>
              </div>
              <span className="text-teal">→</span>
            </Link>
            <Link
              href="/opportunities/import"
              className="aur-card flex items-center justify-between px-3 py-2.5 transition-colors hover:border-white/20"
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                  SAM.gov
                </div>
                <div className="mt-0.5 font-display text-[13px] text-text">
                  Import opportunities
                </div>
              </div>
              <span className="text-teal">→</span>
            </Link>
            <Link
              href="/intelligence"
              className="aur-card flex items-center justify-between px-3 py-2.5 transition-colors hover:border-white/20"
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                  Intelligence
                </div>
                <div className="mt-0.5 font-display text-[13px] text-text">
                  AI brief + insights
                </div>
              </div>
              <span className="text-teal">→</span>
            </Link>
            <Link
              href="/notifications"
              className="aur-card flex items-center justify-between px-3 py-2.5 transition-colors hover:border-white/20"
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                  Inbox
                </div>
                <div className="mt-0.5 font-display text-[13px] text-text">
                  Notifications
                </div>
              </div>
              <span className="text-teal">→</span>
            </Link>
          </div>
        </Panel>
      </section>
    </>
  );
}
