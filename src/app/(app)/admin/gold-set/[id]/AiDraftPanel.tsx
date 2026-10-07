"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { GoldAiDraftState } from "@/db/schema";
import { draftGoldAnnotationsAction, resetGoldDraftAction } from "../actions";

/**
 * BL-AIX Phase 1e-2 — draft this document's annotations with AI. Each call
 * reads as many windows as fit in its budget; the panel keeps calling until
 * the whole text is read. Closing the page pauses it; "Continue" resumes.
 */
export function AiDraftPanel({ docId, state, approved }: { docId: string; state: GoldAiDraftState; approved: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function draft() {
    setError(null);
    startTransition(async () => {
      for (;;) {
        const res = await draftGoldAnnotationsAction(docId);
        if (!res.ok) {
          setError(res.error);
          break;
        }
        setProgress(`${res.windowsDone} of ${res.totalWindows} windows read · ${res.proposed} annotations proposed`);
        if (res.done) break;
      }
      router.refresh();
    });
  }

  const started = (state.windowsDone ?? 0) > 0;
  return (
    <Panel
      title="AI draft"
      eyebrow={state.promptVersion ? `prompt ${state.promptVersion}${state.model ? ` · ${state.model}` : ""}` : "Not started"}
      actions={
        <div className="flex gap-2">
          <button type="button" className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60" disabled={pending || approved} onClick={draft}>
            {pending ? "Drafting…" : started ? "Continue / read new text" : "Draft annotations with AI"}
          </button>
          {started ? (
            <button
              type="button"
              className="aur-btn aur-btn-ghost text-[11px]"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await resetGoldDraftAction(docId);
                  setProgress(null);
                  router.refresh();
                })
              }
              title="Read the whole document again. Annotations already proposed or reviewed stay; duplicates are skipped."
            >
              Start over
            </button>
          ) : null}
        </div>
      }
    >
      <p className="font-mono text-[11px] text-muted">
        The AI reads the document in windows and proposes every requirement, page or format limit and Section M factor it finds,
        quoted from the text. Proposals wait for review below; anything matching an existing annotation, including a rejected one,
        is skipped. It drafts; the expert decides. Search the document for what it may have missed. Keep this page open while it
        works; if it closes, Continue picks up where it stopped. AI usage counts against your own organisation.
      </p>
      <p className="mt-2 font-mono text-[11px] text-text">
        {progress ??
          (started
            ? `${state.windowsDone} windows read · ${state.proposed ?? 0} proposed · ${state.duplicates ?? 0} duplicates skipped${state.windowsFailed ? ` · ${state.windowsFailed} windows failed` : ""}`
            : "")}
      </p>
      {error ? <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
    </Panel>
  );
}
