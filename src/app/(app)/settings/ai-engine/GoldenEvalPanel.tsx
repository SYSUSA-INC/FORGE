"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { JudgeScores } from "@/lib/draft-judge-logic";
import type { GoldenCaseResult } from "@/lib/golden-holdout";
import type { JudgeCalibration } from "@/lib/eval-ratings";
import { runGoldenEvalAction } from "./actions";
import { RateDraft } from "./RateDraft";

/** Keyed `${runId}:${sectionId}`. */
export type MyRatings = Record<string, JudgeScores & { note: string }>;

export type EvalRunRow = {
  id: string;
  promptVersion: string;
  model: string;
  caseCount: number;
  meanScore: number;
  stubbed: boolean;
  createdAt: string;
  results: GoldenCaseResult[];
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
  calibration,
  myRatings,
}: {
  runs: EvalRunRow[];
  goldenCases: number;
  currentPromptVersion: string;
  isAdmin: boolean;
  calibration: JudgeCalibration;
  myRatings: MyRatings;
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
            title="Re-draft up to three won sections from the solicitation context, score them against the text that won and have the rubric judge score them. Up to six AI requests."
          >
            {pending ? "Drafting…" : "Run eval (3 cases)"}
          </button>
        ) : null
      }
    >
      <p className="mb-3 font-mono text-[11px] text-muted">
        Each run re-drafts sections of proposals you won, with the saved text withheld, and scores
        the draft against what won: shared vocabulary (45%), length fit (20%), specificity (20%)
        and placeholder-free prose (15%). Compare runs across prompt versions and models. Each case is
        held out: nothing from its own proposal reaches the drafter, and anything else that copies the
        winning text is dropped. &ldquo;Leak&rdquo; is how much of the winning text still reached the
        prompt (quoted requirements account for some). Runs without the holdout mark scored against a
        context that could contain the answer and are not comparable.
      </p>
      <CalibrationLine calibration={calibration} />
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
              <RunRow key={r.id} run={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} myRatings={myRatings} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

const VERDICT: Record<JudgeCalibration["overall"]["verdict"], string> = {
  collecting: "collecting ratings",
  calibrated: "calibrated: its scores can be trusted",
  disagrees: "disagrees with your experts: do not rely on it yet",
};

/**
 * BL-AIX Phase 1h-2 — how well the rubric judge agrees with this
 * organization's experts, over every draft both have scored.
 */
function CalibrationLine({ calibration }: { calibration: JudgeCalibration }) {
  const a = calibration.overall;
  return (
    <p className="mb-3 font-mono text-[11px] text-muted">
      Rubric judge vs. your experts: {a.n} rated draft{a.n === 1 ? "" : "s"}
      {a.withinOne !== null ? ` · within one point ${pct(a.withinOne)}` : ""}
      {a.spearman !== null ? ` · rank agreement ${a.spearman.toFixed(2)}` : ""}
      {a.meanAbsDiff !== null ? ` · mean gap ${a.meanAbsDiff.toFixed(1)}` : ""} ·{" "}
      <span className={a.verdict === "calibrated" ? "text-emerald" : a.verdict === "disagrees" ? "text-amber-200" : "text-muted"}>
        {VERDICT[a.verdict]}
      </span>
      . The judge scores each draft 1–5 on compliance, evaluation fit, specificity and clarity without seeing the
      winning text; rate drafts below (any member can) until ten are rated.
    </p>
  );
}

function RunRow({ run, open, onToggle, myRatings }: { run: EvalRunRow; open: boolean; onToggle: () => void; myRatings: MyRatings }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-layer/10 hover:bg-layer/[0.03]" onClick={onToggle}>
        <td className="py-1.5 text-muted">{run.createdAt.slice(0, 16).replace("T", " ")}</td>
        <td className="py-1.5 text-text">
          {run.promptVersion || "—"}
          {run.results.some((c) => c.holdout) ? <span className="text-muted"> · holdout</span> : null}
        </td>
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
                    {/* The judge's score shows only after this viewer has rated, so it cannot anchor them. */}
                    {c.judge ? (myRatings[`${run.id}:${c.sectionId}`] ? `judge ${c.judge.scores.overall}/5 · ` : "judged · ") : ""}
                    {c.error
                      ? `error: ${c.error}`
                      : `${pct(c.score)} · terms ${pct(c.termCoverage)} · length ${pct(c.lengthFit)} · specificity ${pct(c.specificity)} · placeholders ${c.placeholderRate}/100w${c.themeCoverage !== null ? ` · themes ${pct(c.themeCoverage)}` : ""} · ${c.draftWords}/${c.goldenWords} words${c.holdout ? ` · leak ${pct(c.holdout.leak)}${c.holdout.dropped ? ` · ${c.holdout.dropped} copied snippet${c.holdout.dropped === 1 ? "" : "s"} dropped` : ""}` : ""}`}
                  </span>
                  <div className="w-full">
                    <RateDraft runId={run.id} kase={c} mine={myRatings[`${run.id}:${c.sectionId}`] ?? null} />
                  </div>
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
