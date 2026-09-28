"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { AiEvalCaseResult } from "@/db/schema";
import { runGoldenEvalAction } from "./actions";

export type EvalRunRow = {
  id: string;
  promptVersion: string;
  model: string;
  caseCount: number;
  meanScore: number;
  stubbed: boolean;
  createdAt: string;
  results: AiEvalCaseResult[];
};

/**
 * BL-AIP-5b — draft quality against the tenant's own won proposals,
 * one row per run, keyed by the drafter's prompt version and model.
 */
export function GoldenEvalPanel({
  runs,
  goldenCases,
  currentPromptVersion,
  isAdmin,
}: {
  runs: EvalRunRow[];
  goldenCases: number;
  currentPromptVersion: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  function run() {
    setNote("");
    startTransition(async () => {
      const res = await runGoldenEvalAction(3);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setNote(
        `Run recorded: ${res.caseCount} case${res.caseCount === 1 ? "" : "s"}, mean ${pct(res.meanScore)}` +
          (res.stubbed ? " (stub provider — not meaningful)" : ""),
      );
      router.refresh();
    });
  }

  return (
    <Panel
      title="Draft quality vs. won proposals"
      eyebrow={`Golden set: ${goldenCases} section${goldenCases === 1 ? "" : "s"} from won proposals · drafter prompt ${currentPromptVersion}`}
      actions={
        isAdmin ? (
          <button
            type="button"
            className="aur-btn aur-btn-ghost text-[11px]"
            disabled={pending || goldenCases === 0}
            onClick={run}
            title="Re-draft up to three won sections from the solicitation context and score them against the text that won. Three AI requests."
          >
            {pending ? "Drafting…" : "Run eval (3 cases)"}
          </button>
        ) : null
      }
    >
      <p className="mb-3 font-mono text-[11px] text-muted">
        Each run re-drafts sections of proposals you won, with the saved text withheld, and scores
        the draft against what won: shared vocabulary (45%), length fit (20%), specificity (20%)
        and placeholder-free prose (15%). Compare runs across prompt versions and models; the
        absolute number is an upper bound because the Brain may already hold the winning text.
      </p>
      {note ? <p className="mb-3 font-mono text-[11px] text-text">{note}</p> : null}
      {runs.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          {goldenCases === 0
            ? "No won proposals with drafted sections yet — record a won outcome on a proposal with written sections and the golden set fills itself."
            : "No runs yet."}
        </p>
      ) : (
        <table className="w-full font-mono text-[11px]">
          <thead className="text-[10px] uppercase tracking-[0.2em] text-subtle">
            <tr>
              <th className="py-1 text-left">When</th>
              <th className="py-1 text-left">Prompt</th>
              <th className="py-1 text-left">Model</th>
              <th className="py-1 text-right">Cases</th>
              <th className="py-1 text-right">Mean</th>
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

function RunRow({ run, open, onToggle }: { run: EvalRunRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-layer/10 hover:bg-layer/[0.03]" onClick={onToggle}>
        <td className="py-1.5 text-muted">{run.createdAt.slice(0, 16).replace("T", " ")}</td>
        <td className="py-1.5 text-text">{run.promptVersion || "—"}</td>
        <td className="py-1.5 text-muted">
          {run.model || "—"}
          {run.stubbed ? " · stub" : ""}
        </td>
        <td className="py-1.5 text-right tabular-nums text-text">{run.caseCount}</td>
        <td className="py-1.5 text-right tabular-nums text-text">{pct(run.meanScore)}</td>
      </tr>
      {open ? (
        <tr className="border-t border-layer/10">
          <td colSpan={5} className="py-2">
            <ul className="flex flex-col gap-1 text-muted">
              {run.results.map((c) => (
                <li key={c.sectionId} className="flex flex-wrap justify-between gap-2">
                  <span className="text-text">
                    {c.sectionTitle}
                    <span className="text-muted"> · {c.agency || "—"}</span>
                  </span>
                  <span className="tabular-nums">
                    {c.error
                      ? `error: ${c.error}`
                      : `${pct(c.score)} · terms ${pct(c.termCoverage)} · length ${pct(c.lengthFit)} · specificity ${pct(c.specificity)} · placeholders ${c.placeholderRate}/100w${c.themeCoverage !== null ? ` · themes ${pct(c.themeCoverage)}` : ""} · ${c.draftWords}/${c.goldenWords} words`}
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
