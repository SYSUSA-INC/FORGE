"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { DocScore, RunSummary } from "@/lib/extraction-eval-logic";
import { CANDIDATE_MODELS } from "@/lib/model-choice";
import { runExtractionEvalAction } from "./actions";

export type EvalRunRow = {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  requestedModel: string;
  promptVersions: Record<string, string>;
  docsTotal: number;
  results: DocScore[];
  summary: Partial<RunSummary>;
  error: string;
};

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);

/**
 * BL-AIX Phase 1e-3 — extraction accuracy against the approved gold
 * documents, one row per run, keyed by the extraction and review prompt
 * versions and the model.
 */
export function AccuracyPanel({ runs, approvedDocs }: { runs: EvalRunRow[]; approvedDocs: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [candidate, setCandidate] = useState("");
  const running = runs.find((r) => r.status === "running");

  function run() {
    setNote(null);
    startTransition(async () => {
      for (;;) {
        const res = await runExtractionEvalAction(candidate);
        if (!res.ok) {
          setNote(res.error);
          break;
        }
        setNote(`${res.docsDone} of ${res.docsTotal} documents scored`);
        if (res.done) break;
      }
      router.refresh();
    });
  }

  return (
    <Panel
      title="Extraction accuracy"
      eyebrow={`${approvedDocs} approved document${approvedDocs === 1 ? "" : "s"}`}
      actions={
        <span className="flex items-center gap-2">
          {running ? null : (
            <>
              <input
                list="accuracy-candidate-models"
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
                placeholder="Model: default"
                aria-label="Candidate model for this run"
                className="aur-input w-44 text-[11px]"
              />
              <datalist id="accuracy-candidate-models">
                {CANDIDATE_MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
          <button type="button" className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60" disabled={pending || approvedDocs === 0} onClick={run}>
            {pending ? "Running…" : running ? "Continue run" : "Run accuracy check"}
          </button>
        </span>
      }
    >
      <p className="mb-3 font-mono text-[11px] text-muted">
        Reads every approved document exactly as intake reads a solicitation (the requirement sweep, then the AI review) and
        scores it against the expert&rsquo;s annotations: requirement recall (target 98%) and precision, page and format limits
        captured (target 100%), Section M factors found and kept in order, and the share of extracted requirements the document
        says word for word (the rest are paraphrased or misread). Compare runs across prompt versions and models:
        name a candidate model to run the check on it without changing any default.
        Keep this page open while it runs; Continue picks up where it stopped. AI usage counts against your own organisation.
      </p>
      {note ? <p className="mb-3 font-mono text-[11px] text-text">{note}</p> : null}
      {runs.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">No runs yet.</p>
      ) : (
        <table className="w-full font-mono text-[11px]">
          <thead className="text-[10px] uppercase tracking-[0.2em] text-subtle">
            <tr>
              <th className="py-1 text-left">When</th>
              <th className="py-1 text-left">Prompts · model</th>
              <th className="py-1 text-right">Docs</th>
              <th className="py-1 text-right">Recall</th>
              <th className="py-1 text-right">Precision</th>
              <th className="py-1 text-right">Limits</th>
              <th className="py-1 text-right">Factors</th>
              <th className="py-1 text-right">Order</th>
              <th className="py-1 text-right" title="Extracted requirements found word for word in the document">Verbatim</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <RunRows key={r.id} run={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function RunRows({ run, open, onToggle }: { run: EvalRunRow; open: boolean; onToggle: () => void }) {
  const s = run.summary;
  return (
    <>
      <tr className="cursor-pointer border-t border-layer/10 hover:bg-layer/[0.03]" onClick={onToggle}>
        <td className="py-1.5 text-muted">{run.createdAt.slice(0, 16).replace("T", " ")}</td>
        <td className="py-1.5 text-text">
          {run.promptVersions.solicitation_extract ?? "—"} / {run.promptVersions.solicitation_review ?? "—"}
          <span className="text-muted">
            {" "}· {run.model || "—"}
            {run.requestedModel ? " (candidate)" : ""}
          </span>
          {run.status !== "done" ? <span className={run.status === "failed" ? "text-rose" : "text-gold"}> · {run.status}</span> : null}
        </td>
        <td className="py-1.5 text-right tabular-nums">
          {run.results.length}/{run.docsTotal}
        </td>
        <td className="py-1.5 text-right tabular-nums text-text">{pct(s.requirementRecall)}</td>
        <td className="py-1.5 text-right tabular-nums text-text">{pct(s.requirementPrecision)}</td>
        <td className="py-1.5 text-right tabular-nums text-text">{pct(s.pageLimitCapture)}</td>
        <td className="py-1.5 text-right tabular-nums text-text">{pct(s.factorRecall)}</td>
        <td className="py-1.5 text-right tabular-nums text-text">{pct(s.factorOrder)}</td>
        <td className="py-1.5 text-right tabular-nums text-text">{pct(s.verbatim)}</td>
      </tr>
      {open ? (
        <tr className="border-t border-layer/10">
          <td colSpan={9} className="py-2">
            {run.error ? <p className="mb-2 text-rose">{run.error}</p> : null}
            <ul className="flex flex-col gap-3 text-muted">
              {run.results.map((d) => (
                <li key={d.docId}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-text">{d.title}</span>
                    <span className="tabular-nums">
                      recall {pct(d.requirementRecall)} ({d.goldRequirements} gold) · precision {pct(d.requirementPrecision)} ({d.extractedRequirements}{" "}
                      extracted) · limits {pct(d.pageLimitCapture)} · factors {pct(d.factorRecall)} · order {pct(d.factorOrder)}
                      {d.verbatim !== undefined ? ` · verbatim ${pct(d.verbatim)}` : ""}
                      {d.windowsFailed ? ` · ${d.windowsFailed} step${d.windowsFailed === 1 ? "" : "s"} failed` : ""}
                    </span>
                  </div>
                  {d.missed.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                      {d.missed.map((m, i) => (
                        <li key={i}>
                          <span className="text-gold">missed {m.kind.replace("_", " ")}:</span> {m.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}
