"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  retrievalMisses,
  type RetrievalCaseResult,
  type RetrievalMode,
  type RetrievalModeSummary,
  type RetrievalSummary,
} from "@/lib/retrieval-eval-logic";
import { runRetrievalEvalAction } from "./actions";

export type RetrievalRunRow = {
  id: string;
  retrievalVersion: string;
  embeddingProvider: string;
  caseCount: number;
  stubbed: boolean;
  createdAt: string;
  summary: RetrievalSummary;
  results: RetrievalCaseResult[];
};

const MODE_LABEL: Record<RetrievalMode, string> = {
  drafter: "Drafter query",
  requirements: "Requirement query",
};

/**
 * BL-AIX Phase 1h-1 — does the Brain find the organization's own winning
 * text when it searches the way the drafter does? One row per run, keyed
 * by the ranking revision.
 */
export function RetrievalEvalPanel({
  runs,
  currentVersion,
  isAdmin,
}: {
  runs: RetrievalRunRow[];
  currentVersion: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  function run() {
    setNote("");
    startTransition(async () => {
      const res = await runRetrievalEvalAction();
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setNote(`Run recorded: ${res.caseCount} case${res.caseCount === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Brain retrieval vs. won proposals"
      eyebrow={`Ranking ${currentVersion} · up to 20 sections per run`}
      actions={
        isAdmin ? (
          <button
            type="button"
            className="aur-btn aur-btn-ghost text-[11px]"
            disabled={pending}
            onClick={run}
            title="Search for sections of won proposals the way the drafter does and check whether their winning text comes back. No AI model call; one search per query."
          >
            {pending ? "Searching…" : "Run retrieval check"}
          </button>
        ) : null
      }
    >
      <p className="mb-3 font-mono text-[11px] text-muted">
        Each case is a section of a proposal you won that is already in the Brain. FORGE searches for
        it twice: with the query the drafter uses for sources (no draft yet), and with the section&apos;s
        mapped requirements. A search succeeds when a result carries that section&apos;s winning text.
        &ldquo;@3&rdquo; and &ldquo;@8&rdquo; are the share of cases found in the top 3 and top 8 (about
        what citation mode passes the drafter); MRR rewards finding it first. Only your
        organization&apos;s proposals and Brain are used.
      </p>
      {note ? <p className="mb-3 font-mono text-[11px] text-text">{note}</p> : null}
      {runs.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          No runs yet. Cases come from won proposals harvested into the Brain (Knowledge base → harvest, or the nightly indexer).
        </p>
      ) : (
        <table className="w-full font-mono text-[11px]">
          <thead className="text-[10px] uppercase tracking-[0.2em] text-subtle">
            <tr>
              <th className="py-1 text-left">When</th>
              <th className="py-1 text-left">Ranking</th>
              <th className="py-1 text-right">Cases</th>
              <th className="py-1 text-right">Drafter @3 / @8 / MRR</th>
              <th className="py-1 text-right">Requirements @3 / @8 / MRR</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <RunRow key={r.id} run={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function cell(s: RetrievalModeSummary | undefined): string {
  if (!s) return "—";
  return `${pct(s.recallAt3)} / ${pct(s.recallAt8)} / ${s.mrr.toFixed(2)} (${s.cases})`;
}

function RunRow({ run, open, onToggle }: { run: RetrievalRunRow; open: boolean; onToggle: () => void }) {
  const errors = run.results.filter((r) => r.error).length;
  return (
    <>
      <tr className="cursor-pointer border-t border-layer/10 hover:bg-layer/[0.03]" onClick={onToggle}>
        <td className="py-1.5 text-muted">{run.createdAt.slice(0, 16).replace("T", " ")}</td>
        <td className="py-1.5 text-text">
          {run.retrievalVersion || "—"}
          <span className="text-muted">
            {run.stubbed ? " · full-text only (stub embeddings)" : run.embeddingProvider ? ` · ${run.embeddingProvider}` : ""}
          </span>
        </td>
        <td className="py-1.5 text-right tabular-nums text-text">
          {run.caseCount}
          {errors ? <span className="text-amber-200"> · {errors} failed</span> : null}
        </td>
        <td className="py-1.5 text-right tabular-nums text-text">{cell(run.summary.drafter)}</td>
        <td className="py-1.5 text-right tabular-nums text-text">{cell(run.summary.requirements)}</td>
      </tr>
      {open ? (
        <tr className="border-t border-layer/10">
          <td colSpan={5} className="py-2">
            {(["drafter", "requirements"] as RetrievalMode[]).map((mode) => {
              const misses = retrievalMisses(run.results, mode);
              if (!run.summary[mode]) return null;
              return (
                <div key={mode} className="mb-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-subtle">
                    {MODE_LABEL[mode]}: not in the top 8 ({misses.length})
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                    {misses.length === 0 ? <li>None.</li> : null}
                    {misses.map((c) => (
                      <li key={`${mode}-${c.sectionId}`} className="flex flex-wrap justify-between gap-2">
                        <span className="text-text">
                          {c.sectionTitle}
                          <span className="text-muted"> · {c.proposalTitle}</span>
                        </span>
                        <span className="tabular-nums">
                          {c.ranks[mode] ? `rank ${c.ranks[mode]}` : "not found"} · {c.hitsReturned[mode] ?? 0} results
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {run.results
              .filter((r) => r.error)
              .map((r) => (
                <p key={`err-${r.sectionId}`} className="text-amber-200">
                  {r.sectionTitle}: {r.error}
                </p>
              ))}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
