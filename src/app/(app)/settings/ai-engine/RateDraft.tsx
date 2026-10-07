"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { JUDGE_DIMENSION_LABELS, JUDGE_DIMENSIONS, type JudgeScores } from "@/lib/draft-judge-logic";
import type { GoldenCaseResult } from "@/lib/golden-holdout";
import { rateGoldenDraftAction } from "./actions";

const SCALE = [1, 2, 3, 4, 5];
type Key = keyof JudgeScores;

/**
 * BL-AIX Phase 1h-2 — read one golden-eval draft and rate it on the
 * judge's rubric. The judge's own scores stay hidden until the expert
 * has rated, so they cannot anchor the rating.
 */
export function RateDraft({
  runId,
  kase,
  mine,
}: {
  runId: string;
  kase: GoldenCaseResult;
  mine: (JudgeScores & { note: string }) | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<Partial<JudgeScores>>(mine ?? {});
  const [note, setNote] = useState(mine?.note ?? "");
  const [msg, setMsg] = useState("");
  const [pending, startTransition] = useTransition();

  if (!kase.draft) return null;
  const judge = kase.judge?.scores ?? null;

  function save() {
    setMsg("");
    startTransition(async () => {
      const res = await rateGoldenDraftAction({ runId, sectionId: kase.sectionId, scores, note });
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="mt-1">
      <button type="button" className="text-[10px] uppercase tracking-[0.2em] text-subtle hover:text-text" onClick={() => setOpen(!open)}>
        {open ? "Hide draft" : mine ? `Your rating ${mine.overall}/5 · edit` : "Read & rate"}
      </button>
      {open ? (
        <div className="mt-2 rounded border border-layer/10 p-3">
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-body text-[12px] leading-relaxed text-text">{kase.draft}</pre>
          <div className="mt-3 grid gap-1">
            {([...JUDGE_DIMENSIONS, "overall"] as Key[]).map((k) => (
              <label key={k} className="flex flex-wrap items-center justify-between gap-2">
                <span title={k === "overall" ? "Your score for the section as a whole" : JUDGE_DIMENSION_LABELS[k as Exclude<Key, "overall">].describe} className="text-text">
                  {k === "overall" ? "Overall" : JUDGE_DIMENSION_LABELS[k as Exclude<Key, "overall">].label}
                </span>
                <span className="flex gap-1">
                  {SCALE.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setScores({ ...scores, [k]: n })}
                      className={`h-6 w-6 rounded border text-[11px] ${scores[k] === n ? "border-cobalt bg-cobalt/20 text-text" : "border-layer/15 text-muted hover:text-text"}`}
                    >
                      {n}
                    </button>
                  ))}
                </span>
              </label>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What an evaluator would say (optional)"
            rows={2}
            className="aur-input mt-2 w-full text-[12px]"
          />
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className="aur-btn aur-btn-ghost text-[11px]" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save rating"}
            </button>
            {msg ? <span className="text-muted">{msg}</span> : null}
          </div>
          {mine && judge ? (
            <p className="mt-2 text-muted">
              Judge: {JUDGE_DIMENSIONS.map((d) => `${JUDGE_DIMENSION_LABELS[d].label.toLowerCase()} ${judge[d]}`).join(" · ")} · overall {judge.overall}
              {kase.judge?.rationale ? ` — ${kase.judge.rationale}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
