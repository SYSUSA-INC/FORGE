import { Panel } from "@/components/ui/Panel";
import { getSectionSignals } from "@/lib/section-signals";
import type { ProposalSectionKind } from "@/db/schema";

const KIND_LABELS: Record<ProposalSectionKind, string> = {
  executive_summary: "Executive summary",
  technical: "Technical",
  management: "Management",
  past_performance: "Past performance",
  pricing: "Pricing",
  compliance: "Compliance",
};

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatDelta(delta: number): { label: string; tone: string } {
  const pp = Math.round(delta * 100);
  if (pp > 5) {
    return {
      label: `+${pp} pp won`,
      tone: "text-emerald-300 bg-emerald-400/10 border-emerald-400/30",
    };
  }
  if (pp < -5) {
    return {
      label: `${pp} pp won`,
      tone: "text-rose bg-rose/10 border-rose/30",
    };
  }
  return {
    label: `±${Math.abs(pp)} pp`,
    tone: "text-muted bg-white/5 border-white/10",
  };
}

export async function SectionSignalsPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const { rows, totalProposalsWithOutcome, totalReviewedSections } =
    await getSectionSignals(organizationId);

  const hasAnyData = rows.some((r) => r.totalSignals > 0);

  return (
    <Panel
      title="Section signals"
      eyebrow={
        hasAnyData
          ? `Reviewer pass rate by section · won vs lost · ${totalProposalsWithOutcome} proposals with outcomes · ${totalReviewedSections} sections reviewed`
          : "Reviewer pass rate by section · won vs lost"
      }
    >
      <p className="font-body text-[13px] leading-relaxed text-muted">
        For each kind of section, this panel compares the per-reviewer
        verdict pass rate from completed color-team reviews against the
        proposal&apos;s final outcome. Big positive deltas mean reviewers
        are correctly catching weak sections in losing proposals; big
        negative deltas (or low pass rates on winners) mean the reviewer
        rubric isn&apos;t predicting outcomes — worth a recalibration.
      </p>

      {!hasAnyData ? (
        <div className="mt-4 rounded-md border border-dashed border-white/10 px-3 py-4 text-center font-mono text-[11px] text-muted">
          No signals yet. Sections need to receive verdicts during
          color-team review (Pink / Red / Gold / White Gloves) <em>and</em>
          the proposal needs a recorded outcome (Win / Loss / No-bid /
          Withdrawn) before they show up here.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full font-body text-[13px]">
            <thead>
              <tr className="border-b border-white/10 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                <th className="pb-2 pr-3">Section kind</th>
                <th className="pb-2 pr-3 text-right">Won — pass rate</th>
                <th className="pb-2 pr-3 text-right">Lost — pass rate</th>
                <th className="pb-2 pr-3 text-right">Delta</th>
                <th className="pb-2 pr-3 text-right">Signals</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const won = row.byOutcome.won;
                const lost = row.byOutcome.lost;
                const delta = won.passRate - lost.passRate;
                const deltaPill = formatDelta(delta);
                const noData = row.totalSignals === 0;
                return (
                  <tr
                    key={row.kind}
                    className="border-b border-white/5 last:border-b-0"
                  >
                    <td className="py-2 pr-3 text-foreground">
                      {KIND_LABELS[row.kind]}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {won.total > 0 ? (
                        <span>
                          <span className="text-emerald-300">
                            {pct(won.passRate)}
                          </span>
                          <span className="ml-1 font-mono text-[11px] text-subtle">
                            ({won.pass}/{won.total})
                          </span>
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-subtle">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {lost.total > 0 ? (
                        <span>
                          <span className="text-rose">{pct(lost.passRate)}</span>
                          <span className="ml-1 font-mono text-[11px] text-subtle">
                            ({lost.pass}/{lost.total})
                          </span>
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-subtle">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {won.total > 0 && lost.total > 0 ? (
                        <span
                          className={`aur-pill ${deltaPill.tone}`}
                          title={`Win pass rate − loss pass rate, in percentage points.`}
                        >
                          {deltaPill.label}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-subtle">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[11px] text-muted">
                      {noData ? "—" : row.totalSignals}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[11px] text-muted">
        Signal counts are <em>per-reviewer-per-section</em>: a section with
        three reviewers in Red Team contributes three signals. Pass rate
        = pass / (pass + conditional + fail).
      </div>
    </Panel>
  );
}
