"use client";

import { useEffect, useState } from "react";
import {
  TONE_THRESHOLDS,
  buildToneFixHint,
  checkTone,
  toneSummary,
  type ToneReport,
} from "@/lib/tone-check";

/**
 * BL-FB-SCAN-TONE — tone and reading level, checked in the browser as
 * the author types (no model call): marketing phrases without evidence,
 * the share of passive sentences and the Flesch-Kincaid grade against
 * the evaluator standard. **Fix with AI** opens Improve mode with the
 * findings as the author's guidance.
 */
const DEBOUNCE_MS = 800;

export function TonePanel({
  text,
  onFix,
  fixBusy,
}: {
  /** The section as plain text, updated on every keystroke. */
  text: string;
  /** Open Improve mode with this guidance. */
  onFix: (hint: string) => void;
  fixBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ToneReport | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setReport(checkTone(text)), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  if (!report || !text.trim()) return null;
  const hint = buildToneFixHint(report);
  const worst = report.flags.some((f) => f.severity === "high")
    ? "high"
    : report.flags.length > 0
      ? "medium"
      : "none";
  const frame =
    worst === "high"
      ? "border-rose-400/30 bg-rose-400/5"
      : worst === "medium"
        ? "border-amber-400/30 bg-amber-400/5"
        : "border-emerald-400/20 bg-emerald-400/5";
  const accent = worst === "high" ? "text-rose-300" : worst === "medium" ? "text-amber-200" : "text-emerald-300";
  const phraseTotal = report.marketing.reduce((n, m) => n + m.count, 0);

  return (
    <div className={`rounded-lg border ${frame}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className={`font-mono text-[10px] uppercase tracking-[0.22em] ${accent}`}>
          ✎ Tone · {toneSummary(report)}
        </span>
        <span className="font-mono text-[10px] text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-layer/10 px-3 py-2">
          <Row
            label="Reading level"
            ok={report.gradeLevel !== null && report.gradeLevel <= TONE_THRESHOLDS.gradeMax}
            pending={report.gradeLevel === null}
          >
            {report.gradeLevel === null
              ? `${TONE_THRESHOLDS.minWords}+ words needed`
              : `grade ${report.gradeLevel.toFixed(1)} (target ≤ ${TONE_THRESHOLDS.gradeMax}) · ${report.avgSentenceWords} words per sentence`}
          </Row>
          <Row
            label="Passive voice"
            ok={report.passiveRate !== null && report.passiveRate <= TONE_THRESHOLDS.passiveRateMax}
            pending={report.passiveRate === null}
          >
            {report.passiveRate === null
              ? `${report.passiveSentences} of ${report.sentences} sentences (${TONE_THRESHOLDS.minSentencesForPassive}+ sentences to judge)`
              : `${report.passiveSentences} of ${report.sentences} sentences (${Math.round(report.passiveRate * 100)}%, target ≤ ${Math.round(TONE_THRESHOLDS.passiveRateMax * 100)}%)`}
            {report.passiveExamples.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {report.passiveExamples.map((s) => (
                  <li key={s} className="font-body text-[11px] italic leading-relaxed text-muted">
                    “{s}”
                  </li>
                ))}
              </ul>
            ) : null}
          </Row>
          <Row label="Marketing language" ok={phraseTotal === 0} pending={false}>
            {phraseTotal === 0 ? (
              "none found"
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {report.marketing.map((m) => (
                  <li
                    key={m.phrase}
                    className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200"
                    title={`Instead: ${m.suggestion}`}
                  >
                    {m.phrase}
                    {m.count > 1 ? ` ×${m.count}` : ""}
                    <span className="ml-1 text-muted">→ {m.suggestion}</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="font-body text-[11px] text-muted">
              Checked in your browser as you type. The evaluator standard is grade {TONE_THRESHOLDS.gradeMax}
              {" "}(college sophomore).
            </span>
            {hint ? (
              <button
                type="button"
                className="aur-btn aur-btn-ghost shrink-0 text-[11px]"
                disabled={fixBusy}
                onClick={() => onFix(hint)}
                title="Open Improve mode with these findings as guidance; the result arrives as tracked changes."
              >
                {fixBusy ? "Fixing…" : "✨ Fix with AI"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  ok,
  pending,
  children,
}: {
  label: string;
  ok: boolean;
  pending: boolean;
  children: React.ReactNode;
}) {
  const dot = pending ? "bg-layer/30" : ok ? "bg-emerald-400" : "bg-amber-400";
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</span>
        <div className="font-body text-[12px] leading-relaxed text-text">{children}</div>
      </div>
    </div>
  );
}
