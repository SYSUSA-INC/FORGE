"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import type { PartnerRateResult } from "@/lib/partner-rate";
import { ratePartnersAction } from "../actions";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * BL-NAV-LIFECYCLE phase 3c-2 (C-7) — FORGE AI's rating of the partners
 * that answered: scored first (gaps closed weighted like coverage,
 * evidence, certifications), one grounded reason each, best first. Advice
 * only: choosing stays on the Partners tab.
 */
export function RatePanel({ opportunityId, partnerCount }: { opportunityId: string; partnerCount: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<PartnerRateResult | null>(null);

  function rate() {
    start(async () => setResult(await ratePartnersAction({ opportunityId })));
  }

  return (
    <Panel
      title="FORGE AI's rating"
      eyebrow={result?.ok ? `${result.rated.length} rated · ${result.gaps} gaps` : "Advice only: you choose"}
      actions={
        <button type="button" onClick={rate} disabled={pending} className="aur-btn aur-btn-primary text-[12px] disabled:opacity-50">
          {pending ? "Rating…" : result ? "Rate again" : `Rate the ${partnerCount === 1 ? "partner" : `${partnerCount} partners`} with FORGE AI`}
        </button>
      }
    >
      {!result ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          FORGE scores each partner on the gaps it closes (required and standing questions weigh in full, expected half, desirable a quarter), the evidence it gave on those answers and its certifications, then FORGE AI explains each score in a sentence that rests on the partner&apos;s own answers. The order is the score&apos;s. It counts as one AI request.
        </p>
      ) : !result.ok ? (
        <p className="font-body text-[13px] text-red">{result.error}</p>
      ) : (
        <>
          {result.dropped > 0 ? (
            <p className="mb-2 font-body text-[12px] text-brass">
              {result.dropped === 1 ? "One reason" : `${result.dropped} reasons`} FORGE AI gave didn&apos;t rest on the partner&apos;s answers and {result.dropped === 1 ? "was" : "were"} left out; the score stands.
            </p>
          ) : null}
          <ol className="divide-y divide-layer/10">
            {result.rated.map((p, i) => (
              <li key={p.id} className="flex flex-col gap-1 py-3 md:flex-row md:items-start md:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[14px] text-text">
                    <span className="mr-2 font-mono text-[12px] text-cobalt">{i + 1}.</span>
                    {p.name}
                    {!p.submitted ? <span className="ml-2 font-mono text-[11px] text-brass">draft, not submitted</span> : null}
                  </p>
                  <p className="font-mono text-[11px] text-muted">
                    closes {p.closed} of {p.gaps} gaps ({pct(p.gapScore)} weighted) · evidence {pct(p.evidenceScore)} · certifications {pct(p.certScore)}
                    {p.certifications.length ? ` · ${p.certifications.join(", ")}` : ""}
                  </p>
                  {p.reason ? (
                    <div className="mt-1 border-l-2 border-cobalt/40 pl-3">
                      <p className="font-body text-[13px] leading-[1.5] text-text">{p.reason}</p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">Rests on</p>
                      <ul className="list-disc pl-4 font-body text-[12px] leading-[1.5] text-muted">
                        {p.cited.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-1 font-body text-[12px] text-muted">No grounded reason from FORGE AI for this partner; the score above stands on the answers.</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[10px] uppercase tracking-label text-muted">Score</div>
                  <div className="font-display text-2xl text-text">{p.score}</div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}
