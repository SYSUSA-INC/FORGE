"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  autoDraftSingleSectionAction,
  listSectionsForAutoDraftAction,
  type AutoDraftSection,
} from "./auto-draft-actions";

type RunState = "idle" | "running" | "done" | "error";

type SectionProgress = {
  id: string;
  title: string;
  state: "pending" | "drafting" | "done" | "skipped" | "error";
  message: string;
};

/**
 * Phase 14e — Auto-draft full proposal.
 *
 * Client-side orchestrator: pulls the section list, then iterates
 * one-section-at-a-time, calling autoDraftSingleSectionAction for
 * each. Each call is a server action so progress can be tracked
 * without holding a single 30+ second request open.
 *
 * Pattern intel from Phase 14d flows through automatically — the
 * underlying generateSectionDraftAction already wires it.
 */
export function AutoDraftButton({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<AutoDraftSection[]>([]);
  const [progress, setProgress] = useState<Record<string, SectionProgress>>({});
  const [runState, setRunState] = useState<RunState>("idle");
  const [overwrite, setOverwrite] = useState(false);
  const [loadingSections, startLoadTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  function loadSections() {
    setError(null);
    startLoadTransition(async () => {
      const res = await listSectionsForAutoDraftAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSections(res.sections);
      const initial: Record<string, SectionProgress> = {};
      for (const s of res.sections) {
        initial[s.id] = {
          id: s.id,
          title: s.title,
          state: s.isEmpty ? "pending" : "skipped",
          message: s.isEmpty
            ? "queued"
            : `${s.wordCount} words — won't overwrite`,
        };
      }
      setProgress(initial);
      setRunState("idle");
    });
  }

  useEffect(() => {
    if (open) loadSections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function runAll() {
    setRunState("running");
    cancelRef.current = false;
    for (const s of sections) {
      if (cancelRef.current) break;
      const isEmpty = s.isEmpty;
      // Skip non-empty sections unless overwrite is on.
      if (!isEmpty && !overwrite) {
        setProgress((p) => ({
          ...p,
          [s.id]: {
            id: s.id,
            title: s.title,
            state: "skipped",
            message: `${s.wordCount} words — skipped`,
          },
        }));
        continue;
      }

      setProgress((p) => ({
        ...p,
        [s.id]: {
          id: s.id,
          title: s.title,
          state: "drafting",
          message: "drafting…",
        },
      }));

      try {
        const res = await autoDraftSingleSectionAction({
          proposalId,
          sectionId: s.id,
          overwrite,
        });
        if (res.ok) {
          setProgress((p) => ({
            ...p,
            [s.id]: {
              id: s.id,
              title: s.title,
              state: "done",
              message: `${res.wordCount} words${res.stubbed ? " (stub)" : ""}`,
            },
          }));
        } else {
          setProgress((p) => ({
            ...p,
            [s.id]: {
              id: s.id,
              title: s.title,
              state: "error",
              message: res.error,
            },
          }));
        }
      } catch (err) {
        setProgress((p) => ({
          ...p,
          [s.id]: {
            id: s.id,
            title: s.title,
            state: "error",
            message: err instanceof Error ? err.message : "Failed.",
          },
        }));
      }
    }
    setRunState("done");
    router.refresh();
  }

  function close() {
    if (runState === "running") {
      cancelRef.current = true;
    }
    setOpen(false);
  }

  const eligible = sections.filter((s) => s.isEmpty || overwrite);
  const completed = Object.values(progress).filter(
    (p) => p.state === "done",
  ).length;
  const failed = Object.values(progress).filter(
    (p) => p.state === "error",
  ).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="aur-btn aur-btn-primary text-[12px]"
        title="Phase 14e — auto-draft every empty section using pattern intel from won proposals."
      >
        Auto-draft proposal
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <div
            className="aur-card-elevated max-h-[90vh] w-full max-w-2xl overflow-y-auto px-5 py-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                  Phase 14e · Auto-draft
                </div>
                <h2 className="mt-1 font-display text-[18px] font-semibold text-foreground">
                  Auto-draft full proposal
                </h2>
                <p className="mt-1 font-body text-[13px] leading-relaxed text-muted">
                  Drafts every empty section using pattern intel from your
                  won proposals (Phase 14d). Sections with existing content
                  are skipped unless you opt in to overwrite.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Close
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
                {error}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 font-mono text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={overwrite}
                  disabled={runState === "running"}
                  onChange={(e) => setOverwrite(e.target.checked)}
                />
                Overwrite sections that already have content
              </label>
              <button
                type="button"
                onClick={runAll}
                disabled={
                  runState === "running" ||
                  loadingSections ||
                  eligible.length === 0
                }
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              >
                {runState === "running"
                  ? "Drafting…"
                  : runState === "done"
                    ? "Run again"
                    : `Draft ${eligible.length} section${eligible.length === 1 ? "" : "s"}`}
              </button>
              <span className="font-mono text-[11px] text-muted">
                {completed} done · {failed} failed
              </span>
            </div>

            <ul className="mt-4 divide-y divide-white/5">
              {sections.map((s) => {
                const p = progress[s.id];
                const tone =
                  p?.state === "done"
                    ? "text-emerald-300"
                    : p?.state === "drafting"
                      ? "text-teal-300"
                      : p?.state === "error"
                        ? "text-rose"
                        : p?.state === "skipped"
                          ? "text-subtle"
                          : "text-muted";
                return (
                  <li
                    key={s.id}
                    className="flex items-start justify-between gap-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-body text-[13px] text-foreground">
                        {s.ordering}. {s.title}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">
                        {s.kind.replace(/_/g, " ")}
                      </div>
                    </div>
                    <div className={`font-mono text-[11px] ${tone}`}>
                      {p?.message ?? "queued"}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[11px] text-muted">
              Auto-drafts always land in <em>in_progress</em> status. Review
              each section before sending to a color-team review.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
