import { Panel } from "@/components/ui/Panel";
import { computePwin } from "@/lib/pwin";
import { CALIBRATION_MIN_N, DEFAULT_BASE_RATE } from "@/lib/pwin-model";
import { ApplyPwinButton } from "./ApplyPwinButton";

const CONFIDENCE_STYLE: Record<string, { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  medium: { label: "Medium confidence", cls: "border-amber-400/40 bg-amber-400/10 text-amber-200" },
  low: { label: "Low confidence", cls: "border-white/15 bg-white/[0.04] text-muted" },
};

/**
 * BL-FB-X-PWIN-MODEL — the model's probability of win for an
 * opportunity, with every factor that moved it, the prior it started
 * from, whether the org's calibration shift applied, and how the model
 * has graded on past outcomes.
 */
export async function PwinPanel({
  organizationId,
  opportunityId,
}: {
  organizationId: string;
  opportunityId: string;
}) {
  const est = await computePwin(organizationId, opportunityId).catch(() => null);
  if (!est) return null;

  const { score, prior, calibration, track, manualPwin } = est;
  const conf = CONFIDENCE_STYLE[score.confidence] ?? CONFIDENCE_STYLE.low!;
  const delta = score.pwin - manualPwin;
  const maxAbs = Math.max(0.3, ...score.factors.map((f) => Math.abs(f.logOdds)));
  const sorted = [...score.factors].sort((a, b) => Math.abs(b.logOdds) - Math.abs(a.logOdds));

  return (
    <Panel
      title="Probability of win"
      eyebrow={`Model ${est.modelVersion} · ${calibration.applied ? "calibrated to this org" : "uncalibrated"}`}
      actions={
        <ApplyPwinButton
          opportunityId={opportunityId}
          modelPwin={score.pwin}
          manualPwin={manualPwin}
        />
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-display text-[40px] font-semibold leading-none text-text">
            {score.pwin}
            <span className="ml-1 font-mono text-[16px] text-muted">%</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${conf.cls}`}
            >
              {conf.label}
            </span>
            <span className="font-mono text-[10px] text-muted">
              Record: {manualPwin}%
              {delta !== 0 ? (
                <span className={delta > 0 ? " text-emerald-300" : " text-rose"}>
                  {" "}
                  ({delta > 0 ? "+" : ""}
                  {delta})
                </span>
              ) : null}
            </span>
          </div>
        </div>
        <div className="font-mono text-[10px] leading-relaxed text-muted">
          <div>
            Base rate {Math.round(prior.baseRate * 100)}%
            {prior.n > 0
              ? ` from ${prior.won} won / ${prior.lost} lost`
              : ` (default ${Math.round(DEFAULT_BASE_RATE * 100)}% — no decided outcomes yet)`}
          </div>
          <div>
            {calibration.applied && calibration.fit
              ? `Calibration shift ${calibration.fit.shift > 0 ? "+" : ""}${calibration.fit.shift} on ${calibration.fit.n} outcomes`
              : `Calibration after ${CALIBRATION_MIN_N} decided outcomes (${prior.n} so far)`}
          </div>
          <div>
            {track.n > 0 && track.brier !== null
              ? `Brier ${track.brier.toFixed(3)} on ${track.n} graded outcome${track.n === 1 ? "" : "s"} (0.25 = coin flip)`
              : "Not yet graded — grades accrue as outcomes are recorded"}
          </div>
        </div>
      </div>

      {sorted.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {sorted.map((f) => {
            const pct = Math.min(100, Math.round((Math.abs(f.logOdds) / maxAbs) * 100));
            const positive = f.logOdds > 0;
            return (
              <li key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-body text-[12px] text-text">{f.label}</span>
                    <span
                      className={`shrink-0 font-mono text-[10px] ${positive ? "text-emerald-300" : "text-rose"}`}
                    >
                      {positive ? "+" : ""}
                      {f.logOdds.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-white/[0.06]">
                    <div
                      className={`h-full ${positive ? "bg-emerald-400/70" : "bg-rose/70"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="w-[140px] truncate text-right font-mono text-[9px] text-muted">
                  {f.detail}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 font-body text-[12px] leading-relaxed text-muted">
          No signals yet. Score the bid/no-bid evaluation, record competitors
          and the incumbent, and set the org&apos;s NAICS and socio-economic
          profile to move this off the base rate.
        </p>
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted">
        Contributions are log-odds; the bar shows relative weight. The
        model excludes this opportunity&apos;s own outcome from its history,
        and every recorded outcome freezes a snapshot so the model is
        graded, not trusted.
      </p>
    </Panel>
  );
}
