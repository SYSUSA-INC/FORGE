import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getLossIntelligence } from "@/lib/loss-intelligence";
import {
  LOSS_THRESHOLDS,
  reasonLabel,
  type LossPattern,
  type LossSeverity,
} from "@/lib/loss-patterns";
import { LossNarrativePanel } from "./LossNarrativePanel";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<LossSeverity, { label: string; cls: string }> = {
  high: { label: "High", cls: "border-rose/40 bg-rose/10 text-rose" },
  medium: { label: "Medium", cls: "border-amber-400/40 bg-amber-400/10 text-amber-200" },
  info: { label: "Data gap", cls: "border-white/15 bg-white/[0.04] text-muted" },
};

const KIND_LABEL: Record<LossPattern["kind"], string> = {
  competitor: "Competitor",
  segment_reason: "Segment × reason",
  price: "Price",
  eligibility: "Eligibility",
  trend: "Trend",
  debrief_gap: "Debrief coverage",
};

/**
 * BL-FB-WIN-CROSS-LOSS — aggregate loss intelligence: the patterns no
 * single pursuit shows, each with its evidence, plus the competitor
 * record and an on-demand AI narrative.
 */
export default async function LossIntelligencePage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const intel = await getLossIntelligence(organizationId);

  const highCount = intel.patterns.filter((p) => p.severity === "high").length;

  return (
    <>
      <PageHeader
        eyebrow="Platform intelligence · Loss intelligence"
        title="Cross-loss patterns"
        subtitle="What your debriefs and outcomes say together that none of them says alone."
        actions={
          <Link href="/intelligence" className="aur-btn aur-btn-ghost text-[11px]">
            ← FORGE Brain
          </Link>
        }
        meta={[
          { label: "Decided", value: String(intel.decided) },
          {
            label: "Win rate",
            value: intel.winRate === null ? "—" : `${Math.round(intel.winRate * 100)}%`,
            accent:
              intel.winRate === null ? undefined : intel.winRate >= 0.4 ? "emerald" : intel.winRate >= 0.2 ? "hazard" : "rose",
          },
          { label: "Losses", value: String(intel.lost) },
          {
            label: "Losses with debrief",
            value: intel.lost === 0 ? "—" : `${intel.lossesWithDebrief}/${intel.lost}`,
            accent:
              intel.lost >= LOSS_THRESHOLDS.debriefGapMinLosses &&
              intel.lossesWithDebrief / intel.lost < LOSS_THRESHOLDS.debriefGapShare
                ? "hazard"
                : undefined,
          },
          {
            label: "Patterns",
            value: String(intel.patterns.length),
            accent: highCount > 0 ? "rose" : intel.patterns.length > 0 ? "hazard" : "emerald",
          },
        ]}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel
            title="Detected patterns"
            eyebrow={`${intel.patterns.length} pattern${intel.patterns.length === 1 ? "" : "s"} · ${highCount} high`}
          >
            {intel.decided === 0 ? (
              <p className="font-body text-[13px] leading-relaxed text-muted">
                No decided outcomes yet. Record wins and losses on each proposal&apos;s
                Outcome tab, name the winner on losses, and capture debriefs. Patterns
                appear once the same competitor, segment or reason shows up across
                pursuits.
              </p>
            ) : intel.patterns.length === 0 ? (
              <p className="font-body text-[13px] leading-relaxed text-muted">
                No pattern has crossed its threshold yet across {intel.decided} decided
                pursuit{intel.decided === 1 ? "" : "s"}. Thresholds: a competitor named
                on {LOSS_THRESHOLDS.competitorMinLosses}+ losses, a segment with{" "}
                {LOSS_THRESHOLDS.segmentMinLosses}+ losses sharing a reason, {LOSS_THRESHOLDS.priceMinSamples}+
                price losses with award values, {LOSS_THRESHOLDS.eligibilityMinLosses}+ losses on
                ineligible set-asides.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {intel.patterns.map((p) => {
                  const sev = SEVERITY_STYLE[p.severity];
                  return (
                    <li
                      key={p.id}
                      id={`pattern-${encodeURIComponent(p.id)}`}
                      className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${sev.cls}`}
                        >
                          {sev.label}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-muted">
                          {KIND_LABEL[p.kind]}
                        </span>
                        <span className="font-display text-[13px] font-semibold text-text">
                          {p.title}
                        </span>
                      </div>
                      <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">
                        {p.detail}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.evidence.slice(0, 8).map((e) => (
                          <Link
                            key={e.proposalId}
                            href={`/proposals/${e.proposalId}/outcome`}
                            className="max-w-[260px] truncate rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-white/30 hover:text-text"
                            title={e.title}
                          >
                            {e.title}
                            {e.decidedAt ? ` · ${e.decidedAt.slice(0, 10)}` : ""}
                          </Link>
                        ))}
                        {p.evidence.length > 8 ? (
                          <span className="font-mono text-[10px] text-muted">
                            +{p.evidence.length - 8} more
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Competitor record"
            eyebrow={`${intel.competitors.length} tracked · faced vs lost to`}
          >
            {intel.competitors.length === 0 ? (
              <p className="font-body text-[13px] leading-relaxed text-muted">
                Add competitors on opportunities and name the winner when you record a
                loss. The record fills in from there.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-white/10 text-muted">
                      <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Competitor</th>
                      <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">Faced</th>
                      <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">Lost to</th>
                      <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">Won against</th>
                      <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Leading reason</th>
                      <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Last loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intel.competitors.slice(0, 25).map((c) => (
                      <tr key={c.name} className="border-b border-white/[0.04] text-text/90">
                        <td className="px-2 py-1.5">
                          {c.name}
                          {c.agencies.length ? (
                            <div className="font-mono text-[10px] text-muted">
                              {c.agencies.slice(0, 3).join(" · ")}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-right">{c.faced}</td>
                        <td className={`px-2 py-1.5 text-right ${c.lostTo >= 2 ? "text-rose" : ""}`}>
                          {c.lostTo}
                        </td>
                        <td className="px-2 py-1.5 text-right text-emerald-300">{c.wonAgainst}</td>
                        <td className="px-2 py-1.5 text-muted">
                          {c.leadingReason ? reasonLabel(c.leadingReason) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted">
                          {c.lastLossAt ? c.lastLossAt.slice(0, 10) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <LossNarrativePanel decided={intel.decided} patternCount={intel.patterns.length} />
          <Panel title="Loss reasons" eyebrow="Losses citing each">
            {intel.reasonTotals.length === 0 ? (
              <p className="font-body text-[12px] text-muted">No reasons recorded on losses yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {intel.reasonTotals.map((r) => {
                  const max = intel.reasonTotals[0]?.count ?? 1;
                  return (
                    <li key={r.reason} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 truncate font-mono text-[11px] text-text">{r.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-white/[0.05]">
                        <div className="h-full bg-rose/70" style={{ width: `${Math.max(6, (r.count / max) * 100)}%` }} />
                      </div>
                      <span className="w-6 text-right font-mono text-[11px] text-rose">{r.count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
