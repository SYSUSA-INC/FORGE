import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalDebriefs,
  proposalOutcomes,
  proposals,
  users,
  type ProposalOutcomeReason,
  type ProposalOutcomeType,
} from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import {
  DEBRIEF_STATUS_LABELS,
  OUTCOME_REASON_LABELS,
  OUTCOME_TYPE_COLORS,
  OUTCOME_TYPE_LABELS,
} from "@/lib/proposal-outcome-types";

const TOP_REASON_LIMIT = 5;
const RECENT_LESSONS_LIMIT = 5;

export async function OutcomeInsightsPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  // Pull every outcome for this org joined to its proposal title.
  const outcomeRows = await db
    .select({
      id: proposalOutcomes.id,
      proposalId: proposalOutcomes.proposalId,
      proposalTitle: proposals.title,
      outcomeType: proposalOutcomes.outcomeType,
      reasons: proposalOutcomes.reasons,
      summary: proposalOutcomes.summary,
      lessonsLearned: proposalOutcomes.lessonsLearned,
      decisionDate: proposalOutcomes.decisionDate,
      authorName: users.name,
      authorEmail: users.email,
      updatedAt: proposalOutcomes.updatedAt,
    })
    .from(proposalOutcomes)
    .innerJoin(proposals, eq(proposals.id, proposalOutcomes.proposalId))
    .leftJoin(users, eq(users.id, proposalOutcomes.createdByUserId))
    .where(eq(proposalOutcomes.organizationId, organizationId))
    .orderBy(desc(proposalOutcomes.updatedAt));

  // Debriefs: held / scheduled (the actionable ones).
  const debriefRows = await db
    .select({
      id: proposalDebriefs.id,
      proposalId: proposalDebriefs.proposalId,
      proposalTitle: proposals.title,
      status: proposalDebriefs.status,
      scheduledFor: proposalDebriefs.scheduledFor,
      heldOn: proposalDebriefs.heldOn,
    })
    .from(proposalDebriefs)
    .innerJoin(proposals, eq(proposals.id, proposalDebriefs.proposalId))
    .where(eq(proposalDebriefs.organizationId, organizationId))
    .orderBy(desc(proposalDebriefs.updatedAt));

  // Aggregate.
  const totals: Record<ProposalOutcomeType, number> = {
    won: 0,
    lost: 0,
    no_bid: 0,
    withdrawn: 0,
  };
  const winReasons: Record<string, number> = {};
  const lossReasons: Record<string, number> = {};
  for (const o of outcomeRows) {
    totals[o.outcomeType] = (totals[o.outcomeType] ?? 0) + 1;
    const bucket = o.outcomeType === "won" ? winReasons : lossReasons;
    if (o.outcomeType !== "won" && o.outcomeType !== "lost" && o.outcomeType !== "no_bid")
      continue;
    for (const r of (o.reasons ?? []) as string[]) {
      bucket[r] = (bucket[r] ?? 0) + 1;
    }
  }

  const total = outcomeRows.length;
  const decisive = totals.won + totals.lost; // wins + losses, excluding no-bid/withdrawn
  const winRate = decisive > 0 ? totals.won / decisive : 0;

  const topWinReasons = topN(winReasons, TOP_REASON_LIMIT);
  const topLossReasons = topN(lossReasons, TOP_REASON_LIMIT);

  const recentLessons = outcomeRows
    .filter((o) => o.lessonsLearned.trim().length > 0)
    .slice(0, RECENT_LESSONS_LIMIT);

  const openDebriefs = debriefRows.filter(
    (d) => d.status === "scheduled" || d.status === "requested" || d.status === "held",
  );

  if (total === 0 && debriefRows.length === 0) {
    return (
      <Panel title="Outcome insights" eyebrow="Win/loss + debriefs">
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Once your team starts closing proposals (Awarded / Lost / No Bid)
          and recording outcomes via the proposal Outcome tab, win-rate
          analytics, top win/loss reasons, and a lessons-learned feed will
          appear here.
        </p>
        <p className="mt-2 font-body text-[12px] leading-relaxed text-subtle">
          The data this panel reads — outcome reasons, lessons learned,
          debrief notes — is the seed for the autonomous-intelligence work
          downstream (embedding + retrieval + evaluator-mirror).
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Outcome insights"
        eyebrow="Win/loss + debriefs"
        actions={
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {total} outcome{total === 1 ? "" : "s"} captured
          </span>
        }
      >
        <div className="grid gap-3 md:grid-cols-4">
          <Stat
            label="Win rate"
            value={
              decisive === 0 ? "—" : `${Math.round(winRate * 100)}%`
            }
            color={winRate >= 0.4 ? "#10B981" : winRate >= 0.2 ? "#F59E0B" : "#EF4444"}
            sub={
              decisive === 0
                ? "no decisive yet"
                : `${totals.won} won / ${totals.lost} lost`
            }
          />
          <Stat
            label="Won"
            value={String(totals.won)}
            color={OUTCOME_TYPE_COLORS.won}
          />
          <Stat
            label="Lost"
            value={String(totals.lost)}
            color={OUTCOME_TYPE_COLORS.lost}
          />
          <Stat
            label="No-bid / withdrawn"
            value={String(totals.no_bid + totals.withdrawn)}
            color="#64748B"
            sub={
              totals.withdrawn
                ? `${totals.no_bid} no-bid · ${totals.withdrawn} withdrawn`
                : undefined
            }
          />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReasonsPanel
          title="Top win reasons"
          eyebrow="Why we won"
          reasons={topWinReasons}
          color={OUTCOME_TYPE_COLORS.won}
          empty="No wins captured yet."
        />
        <ReasonsPanel
          title="Top loss reasons"
          eyebrow="Why we lost"
          reasons={topLossReasons}
          color={OUTCOME_TYPE_COLORS.lost}
          empty="No losses captured yet."
        />
      </div>

      <Panel
        title="Lessons learned"
        eyebrow={`${recentLessons.length} most recent`}
      >
        {recentLessons.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No lessons-learned notes captured yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentLessons.map((l) => (
              <li
                key={l.id}
                className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
                  <span
                    className="rounded px-1.5 py-0.5 uppercase tracking-widest"
                    style={{
                      color: OUTCOME_TYPE_COLORS[l.outcomeType],
                      backgroundColor: `${OUTCOME_TYPE_COLORS[l.outcomeType]}1A`,
                      border: `1px solid ${OUTCOME_TYPE_COLORS[l.outcomeType]}50`,
                    }}
                  >
                    {OUTCOME_TYPE_LABELS[l.outcomeType]}
                  </span>
                  <Link
                    href={`/proposals/${l.proposalId}/outcome`}
                    className="truncate font-display text-[12px] text-text hover:underline"
                  >
                    {l.proposalTitle}
                  </Link>
                  <span className="ml-auto text-subtle">
                    {l.decisionDate
                      ? new Date(l.decisionDate).toISOString().slice(0, 10)
                      : new Date(l.updatedAt).toISOString().slice(0, 10)}
                    {l.authorName ? ` · ${l.authorName}` : ""}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-3 font-body text-[12px] leading-relaxed text-muted">
                  {l.lessonsLearned}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Open debriefs"
        eyebrow={`${openDebriefs.length} actionable`}
      >
        {openDebriefs.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No open debriefs. Capture them from the proposal's Outcome tab
            when government feedback comes in.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {openDebriefs.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/proposals/${d.proposalId}/outcome`}
                  className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 hover:border-white/20"
                >
                  <span className="truncate font-display text-[13px] text-text">
                    {d.proposalTitle}
                  </span>
                  <div className="flex items-center gap-3 font-mono text-[10px] text-muted">
                    <span className="uppercase tracking-widest">
                      {DEBRIEF_STATUS_LABELS[d.status]}
                    </span>
                    {d.scheduledFor ? (
                      <span>
                        {new Date(d.scheduledFor).toISOString().slice(0, 10)}
                      </span>
                    ) : d.heldOn ? (
                      <span>
                        held{" "}
                        {new Date(d.heldOn).toISOString().slice(0, 10)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function topN(
  buckets: Record<string, number>,
  n: number,
): { reason: string; count: number }[] {
  return Object.entries(buckets)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function Stat({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="aur-card px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </div>
      <div
        className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight"
        style={{ color }}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[10px] text-subtle">{sub}</div>
      ) : null}
    </div>
  );
}

function ReasonsPanel({
  title,
  eyebrow,
  reasons,
  color,
  empty,
}: {
  title: string;
  eyebrow: string;
  reasons: { reason: string; count: number }[];
  color: string;
  empty: string;
}) {
  const max = reasons[0]?.count ?? 1;
  return (
    <Panel title={title} eyebrow={eyebrow}>
      {reasons.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">{empty}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {reasons.map((r) => {
            const pct = Math.max(8, (r.count / max) * 100);
            const label =
              OUTCOME_REASON_LABELS[r.reason as ProposalOutcomeReason] ??
              r.reason;
            return (
              <li key={r.reason} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate font-mono text-[11px] text-text">
                  {label}
                </span>
                <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: color,
                      opacity: 0.8,
                    }}
                  />
                </div>
                <span
                  className="w-8 text-right font-mono text-[11px] tabular-nums"
                  style={{ color }}
                >
                  {r.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
