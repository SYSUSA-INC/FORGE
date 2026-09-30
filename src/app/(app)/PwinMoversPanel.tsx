import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { STAGE_LABELS } from "@/lib/opportunity-types";
import { listPwinMovers, type PwinMoverView } from "@/lib/pwin-nightly";
import type { OpportunityStage } from "@/db/schema";

/**
 * BL-AIP-7b part ii — "PWin movers": the live pursuits whose calibrated
 * PWin moved most over the last week, with the factor changes behind
 * each. Renders nothing while nothing has moved (the nightly cron needs
 * two snapshots of a pursuit before it can move).
 */
export async function PwinMoversPanel({
  organizationId,
  limit = 6,
  eyebrowSuffix = "",
}: {
  organizationId: string;
  limit?: number;
  eyebrowSuffix?: string;
}) {
  const movers = await listPwinMovers({ organizationId, limit }).catch(() => [] as PwinMoverView[]);
  if (movers.length === 0) return null;

  const up = movers.filter((m) => m.delta > 0).length;
  const down = movers.length - up;

  return (
    <section className="mb-6">
      <Panel
        title="PWin movers"
        eyebrow={`Last 7 days · ${up} up · ${down} down${eyebrowSuffix}`}
        accent={down > up ? "rose" : "emerald"}
        actions={
          <Link
            href="/pipeline"
            className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
          >
            Pipeline →
          </Link>
        }
      >
        <ul className="flex flex-col gap-1.5">
          {movers.map((m) => {
            const rising = m.delta > 0;
            return (
              <li key={m.opportunityId}>
                <Link
                  href={`/opportunities/${m.opportunityId}`}
                  className="block rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2 hover:border-layer/20"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                        rising
                          ? "border-emerald/40 bg-emerald/10 text-emerald-300"
                          : "border-rose/40 bg-rose/10 text-rose-300"
                      }`}
                    >
                      {rising ? "▲" : "▼"} {m.from}% → {m.to}%
                    </span>
                    <span className="min-w-0 truncate font-display text-[13px] text-text">{m.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted">
                      {STAGE_LABELS[m.stage as OpportunityStage] ?? m.stage} · {m.confidence} confidence · {m.days}d
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                    {m.agency || "—"}
                  </div>
                  {m.reasons.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-0.5 font-body text-[12px] leading-relaxed text-muted">
                      {m.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 font-body text-[12px] text-subtle">
                      The organization&apos;s track record shifted; no single factor moved.
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>
    </section>
  );
}
