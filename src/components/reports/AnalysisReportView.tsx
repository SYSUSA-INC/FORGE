import { ANALYSIS_CALL_LABELS, type AnalysisReportBody } from "@/lib/opportunity-report";

const CALL_TONE = { pursue: "text-green", watch: "text-brass", no_bid: "text-red" } as const;

function Section({ title, lines, empty }: { title: string; lines: string[]; empty: string }) {
  return (
    <section aria-label={title} className="break-inside-avoid border-t border-layer/10 py-3">
      <h2 className="mb-1.5 font-mono text-[11px] uppercase tracking-label text-muted">{title}</h2>
      {lines.length === 0 ? (
        <p className="font-body text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 font-body text-[13px] leading-[1.5] text-text print:text-black">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * BL-NAV-LIFECYCLE phase 2c — one Analysis Report: the call and why, the
 * win probability with its factors, fit, competition, risks, what would
 * raise PWin, and what FORGE read. Shared by the Analyze page and the
 * printable report page. Server-safe.
 */
export function AnalysisReportView({ body }: { body: AnalysisReportBody }) {
  const factors = body.pwin ? [...body.pwin.factors].sort((a, b) => Math.abs(b.logOdds) - Math.abs(a.logOdds)) : [];
  return (
    <div>
      <section aria-label="Summary" className="py-3">
        <p className={`font-mono text-[12px] uppercase tracking-widest ${CALL_TONE[body.call]} print:text-black`}>{ANALYSIS_CALL_LABELS[body.call]}</p>
        <p className="mt-1 font-body text-[14px] leading-[1.6] text-text print:text-black">{body.summary}</p>
        {body.stubbed ? <p className="mt-1 font-mono text-[11px] text-brass">Written from FORGE&apos;s facts only: no AI provider was configured.</p> : null}
      </section>
      <section aria-label="Win probability" className="break-inside-avoid border-t border-layer/10 py-3">
        <h2 className="mb-1.5 font-mono text-[11px] uppercase tracking-label text-muted">Win probability</h2>
        {body.pwin ? (
          <>
            <p className="font-display text-2xl">
              {body.pwin.pwin}% <span className="font-mono text-[11px] text-muted">{body.pwin.confidence} confidence</span>
            </p>
            <table className="mt-2 w-full border-collapse font-body text-[13px]">
              <tbody>
                {factors.map((f) => (
                  <tr key={f.label} className="border-t border-layer/10 align-top">
                    <td className="py-1.5 pr-3 text-text print:text-black">{f.label}</td>
                    <td className="py-1.5 pr-3 text-muted">{f.detail}</td>
                    <td className={`w-16 py-1.5 text-right font-mono text-[12px] ${f.logOdds >= 0 ? "text-green" : "text-red"} print:text-black`}>
                      {f.logOdds >= 0 ? "+" : ""}
                      {f.logOdds.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="font-body text-[13px] text-muted">The PWin model couldn&apos;t score this opportunity.</p>
        )}
      </section>
      <Section title="Fit" lines={body.fit} empty="Nothing to say on fit from what FORGE holds." />
      <Section title="Competition" lines={body.competition} empty="No incumbent or competitors known." />
      <Section title="Risks" lines={body.risks} empty="No risks found in what FORGE holds." />
      <Section title="What would raise PWin" lines={body.raisePwin} empty="Nothing specific." />
      <Section title="What FORGE read" lines={body.sources} empty="—" />
    </div>
  );
}
