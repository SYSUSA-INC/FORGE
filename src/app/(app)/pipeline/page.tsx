import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { STAGES, STAGE_COLORS, STAGE_LABELS } from "@/lib/opportunity-types";

export const dynamic = "force-dynamic";

const ACTIVE_STAGES = [
  "identified",
  "sources_sought",
  "qualification",
  "capture",
  "pre_proposal",
  "writing",
  "submitted",
] as const;

export default async function PipelinePage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      stage: opportunities.stage,
      pWin: opportunities.pWin,
      valueLow: opportunities.valueLow,
      valueHigh: opportunities.valueHigh,
      responseDueDate: opportunities.responseDueDate,
    })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId));

  const byStage = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byStage.get(r.stage) ?? [];
    list.push(r);
    byStage.set(r.stage, list);
  }

  const total = rows.length;
  const active = rows.filter((r) =>
    (ACTIVE_STAGES as readonly string[]).includes(r.stage),
  ).length;
  const won = byStage.get("won")?.length ?? 0;
  const lost = byStage.get("lost")?.length ?? 0;
  const decisive = won + lost;
  const winRate = decisive > 0 ? Math.round((won / decisive) * 100) : null;

  const totalHigh = rows.reduce(
    (acc, r) => acc + parseDollars(r.valueHigh ?? ""),
    0,
  );

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Opportunity pipeline"
        subtitle="Live counts across the ten stages, computed from your opportunities table."
        actions={
          <>
            <Link href="/opportunities/import" className="aur-btn">
              Import from SAM.gov
            </Link>
            <Link href="/opportunities/new" className="aur-btn aur-btn-primary">
              + New opportunity
            </Link>
          </>
        }
        meta={[
          { label: "Total", value: String(total).padStart(2, "0") },
          {
            label: "Active",
            value: String(active).padStart(2, "0"),
            accent: active > 0 ? "magenta" : undefined,
          },
          {
            label: "Win rate",
            value: winRate === null ? "—" : `${winRate}%`,
            accent:
              winRate !== null && winRate >= 40
                ? "emerald"
                : winRate !== null && winRate >= 20
                  ? "gold"
                  : undefined,
          },
          {
            label: "Est. value (high)",
            value:
              totalHigh === 0
                ? "—"
                : totalHigh >= 1_000_000_000
                  ? `$${(totalHigh / 1_000_000_000).toFixed(2)}B`
                  : totalHigh >= 1_000_000
                    ? `$${(totalHigh / 1_000_000).toFixed(0)}M`
                    : `$${totalHigh.toLocaleString()}`,
          },
        ]}
      />

      {total === 0 ? (
        <Panel title="Empty pipeline">
          <p className="font-body text-[14px] leading-relaxed text-muted">
            No opportunities yet. Create one manually or import a batch from
            SAM.gov to populate the pipeline.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/opportunities/new" className="aur-btn aur-btn-primary">
              + New opportunity
            </Link>
            <Link href="/opportunities/import" className="aur-btn">
              Import from SAM.gov
            </Link>
          </div>
        </Panel>
      ) : (
        <>
          <Panel title="Stage funnel" eyebrow={`${total} total`}>
            <ul className="flex flex-col gap-2">
              {STAGES.map((s) => {
                const items = byStage.get(s.key) ?? [];
                const pct =
                  total === 0 ? 0 : Math.round((items.length / total) * 100);
                const color = STAGE_COLORS[s.key];
                return (
                  <li key={s.key}>
                    <div className="flex items-center gap-3">
                      <span
                        className="w-40 shrink-0 truncate font-mono text-[11px] uppercase tracking-widest"
                        style={{ color }}
                      >
                        {s.label}
                      </span>
                      <div className="relative h-6 flex-1 overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${Math.max(pct, items.length > 0 ? 6 : 0)}%`,
                            background: `${color}40`,
                            borderRight: items.length
                              ? `2px solid ${color}`
                              : undefined,
                          }}
                        />
                        <span className="absolute inset-y-0 left-2 flex items-center font-mono text-[10px] tabular-nums text-text">
                          {items.length}
                        </span>
                      </div>
                      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-subtle">
                        {pct}%
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Active opportunities" eyebrow={`${active} live`}>
              {active === 0 ? (
                <p className="font-mono text-[11px] text-muted">
                  Nothing active.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {rows
                    .filter((r) =>
                      (ACTIVE_STAGES as readonly string[]).includes(r.stage),
                    )
                    .sort(
                      (a, b) =>
                        (a.responseDueDate?.getTime() ?? Infinity) -
                        (b.responseDueDate?.getTime() ?? Infinity),
                    )
                    .slice(0, 10)
                    .map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/opportunities/${r.id}`}
                          className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 hover:border-white/20"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-display text-[13px] text-text">
                              {r.title}
                            </div>
                            <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                              {r.agency || "—"}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3 font-mono text-[10px]">
                            <span
                              style={{
                                color:
                                  STAGE_COLORS[r.stage as keyof typeof STAGE_COLORS] ??
                                  "#9BC9D9",
                              }}
                            >
                              {STAGE_LABELS[r.stage as keyof typeof STAGE_LABELS] ??
                                r.stage}
                            </span>
                            {r.responseDueDate ? (
                              <span className="text-subtle">
                                due{" "}
                                {r.responseDueDate.toISOString().slice(0, 10)}
                              </span>
                            ) : null}
                          </div>
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Outcome split"
              eyebrow={
                decisive === 0
                  ? "no closed pursuits yet"
                  : `${decisive} closed`
              }
            >
              {decisive === 0 ? (
                <p className="font-body text-[13px] text-muted">
                  Mark opportunities as Won / Lost / No Bid to see the outcome
                  split here.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  <Row label="Won" count={won} color="#10B981" total={decisive} />
                  <Row label="Lost" count={lost} color="#EF4444" total={decisive} />
                  <Row
                    label="No-bid"
                    count={byStage.get("no_bid")?.length ?? 0}
                    color="#64748B"
                    total={decisive}
                  />
                </ul>
              )}
              {decisive > 0 ? (
                <p className="mt-3 font-mono text-[10px] text-subtle">
                  Win rate excludes no-bid from the denominator. For richer
                  insights — top reasons, lessons learned —{" "}
                  <Link href="/intelligence" className="text-teal underline">
                    open Intelligence
                  </Link>
                  .
                </p>
              ) : null}
            </Panel>
          </section>
        </>
      )}
    </>
  );
}

function Row({
  label,
  count,
  color,
  total,
}: {
  label: string;
  count: number;
  color: string;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <li className="flex items-center gap-3">
      <span
        className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-widest"
        style={{ color }}
      >
        {label}
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color, opacity: 0.8 }}
        />
      </div>
      <span
        className="w-8 text-right font-mono text-[11px] tabular-nums"
        style={{ color }}
      >
        {count}
      </span>
    </li>
  );
}

function parseDollars(s: string): number {
  if (!s) return 0;
  const trimmed = s.trim().replace(/[$,]/g, "");
  const m = trimmed.match(/^([\d.]+)\s*([kKmMbB])?$/);
  if (!m) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : 0;
  }
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return 0;
  const suffix = (m[2] ?? "").toLowerCase();
  if (suffix === "k") return base * 1_000;
  if (suffix === "m") return base * 1_000_000;
  if (suffix === "b") return base * 1_000_000_000;
  return base;
}
