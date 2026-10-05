"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AutoDraftProgress } from "@/lib/auto-draft-logic";
import {
  autoDraftProgressAction,
  listSectionsForAutoDraftAction,
  startAutoDraftAction,
  type AutoDraftSection,
} from "./auto-draft-actions";

type Progress = AutoDraftProgress & { titles: Record<string, string> };

const POLL_MS = 5_000;

const STATE_LABEL = { queued: "queued", running: "drafting…", done: "done", failed: "failed" } as const;
const STATE_TONE = { queued: "text-muted", running: "text-teal", done: "text-emerald", failed: "text-rose" } as const;

/**
 * Phase 14e → BL-AIX Phase 0c — auto-draft the whole proposal.
 *
 * The drafting runs on the server: one durable job per section, kept
 * moving while this dialog polls and finished by the jobs cron if it
 * closes. Sections that already have text are skipped unless
 * "Overwrite" is ticked, and then the draft arrives as FORGE AI tracked
 * changes on top of a snapshot of the old text.
 */
export function AutoDraftButton({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<AutoDraftSection[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const res = await autoDraftProgressAction(proposalId);
    if (res.ok) setProgress(res.progress);
    else setError(res.error);
    return res.ok ? res.progress : null;
  }, [proposalId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    startTransition(async () => {
      const res = await listSectionsForAutoDraftAction(proposalId);
      if (res.ok) setSections(res.sections);
      else setError(res.error);
      await refresh();
    });
  }, [open, proposalId, refresh]);

  // Poll while a run is active; refresh the page once it settles.
  const active = progress?.active ?? false;
  useEffect(() => {
    if (!open || !active) return;
    const t = window.setInterval(async () => {
      const next = await refresh();
      if (next && !next.active) router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [open, active, refresh, router]);

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await startAutoDraftAction({ proposalId, overwrite });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await refresh();
    });
  }

  const eligible = sections.filter((s) => s.isEmpty || overwrite);
  const titleOf = (id: string) => progress?.titles[id] ?? sections.find((s) => s.id === id)?.title ?? "Section";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="aur-btn aur-btn-primary text-[12px]"
        title="Auto-draft every empty section on the server, grounded in your won proposals."
      >
        Auto-draft proposal
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="aur-card-elevated max-h-[90vh] w-full max-w-2xl overflow-y-auto px-5 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Auto-draft</div>
                <h2 className="mt-1 font-display text-[18px] font-semibold text-foreground">Auto-draft full proposal</h2>
                <p className="mt-1 font-body text-[13px] leading-relaxed text-muted">
                  Drafts every empty section on the server, with citations, grounded in your won proposals. You can close this
                  window — the run carries on and the sections fill in as each draft lands.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="aur-btn aur-btn-ghost text-[11px]">
                Close
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 font-mono text-[11px] text-muted">
                <input type="checkbox" checked={overwrite} disabled={active || pending} onChange={(e) => setOverwrite(e.target.checked)} />
                Overwrite sections that already have text (as tracked suggestions)
              </label>
              <button
                type="button"
                onClick={start}
                disabled={active || pending || eligible.length === 0}
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              >
                {active ? "Drafting…" : `Draft ${eligible.length} section${eligible.length === 1 ? "" : "s"}`}
              </button>
              {progress && progress.total > 0 ? (
                <span className="font-mono text-[11px] text-muted">
                  {progress.done} done · {progress.running + progress.queued} to go · {progress.failed} failed
                </span>
              ) : null}
            </div>

            {progress && progress.sections.length > 0 ? (
              <ul className="mt-4 divide-y divide-layer/5">
                {progress.sections.map((s) => (
                  <li key={s.sectionId} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0 flex-1 font-body text-[13px] text-foreground">{titleOf(s.sectionId)}</div>
                    <div className={`max-w-[60%] text-right font-mono text-[11px] ${STATE_TONE[s.status]}`}>
                      {s.note || STATE_LABEL[s.status]}
                      {s.truncated ? <span className="ml-1 text-gold">· cut off at the length limit</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 font-body text-[12px] text-subtle">
                {sections.length === 0 ? "Loading sections…" : `${eligible.length} of ${sections.length} sections would be drafted.`}
              </p>
            )}

            <div className="mt-4 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2 font-mono text-[11px] text-muted">
              Drafts land in <em>in progress</em> and queue a background health scan. Over existing text they arrive as FORGE AI
              suggestions, with a snapshot of the old text kept in version history. A draft that stopped at the length limit ends
              with a [CONTINUE] marker.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
