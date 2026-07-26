"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { updateWinThemesAction } from "../actions";

type Theme = { title: string; statement: string };

const MAX_THEMES = 3;
const EMPTY: Theme = { title: "", statement: "" };

export function WinThemesPanel({
  proposalId,
  initial,
}: {
  proposalId: string;
  initial: Theme[];
}) {
  const router = useRouter();
  const [themes, setThemes] = useState<Theme[]>(
    initial.length > 0 ? initial : [EMPTY],
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function update(i: number, patch: Partial<Theme>) {
    setError(null);
    setSuccess(false);
    setThemes((prev) =>
      prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    );
  }

  function addTheme() {
    if (themes.length >= MAX_THEMES) return;
    setSuccess(false);
    setThemes((prev) => [...prev, { ...EMPTY }]);
  }

  function removeTheme(i: number) {
    setSuccess(false);
    setThemes((prev) =>
      prev.length === 1 ? [{ ...EMPTY }] : prev.filter((_, idx) => idx !== i),
    );
  }

  function save() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updateWinThemesAction(
        proposalId,
        themes.map((t) => ({
          title: t.title.trim(),
          statement: t.statement.trim(),
        })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  const persistedCount = themes.filter(
    (t) => t.title.trim() && t.statement.trim(),
  ).length;

  return (
    <Panel
      title="Win themes"
      eyebrow={
        persistedCount > 0
          ? `${persistedCount} theme${persistedCount === 1 ? "" : "s"} active`
          : "Drive every section draft"
      }
      actions={
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      }
    >
      <p className="font-body text-[12px] leading-relaxed text-muted">
        Set 1–{MAX_THEMES} win themes that should thread through every
        section. The section drafter weaves them in explicitly; the AI
        scan can also check downstream that drafts reinforce them.
        Example title: <em>FedRAMP High depth</em>. Example statement:
        <em>
          {" "}
          We hold a FedRAMP High ATO today and will operate the new
          environment under that authorization on day one.
        </em>
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {themes.map((t, i) => (
          <li
            key={i}
            className="rounded-md border border-white/10 bg-white/[0.02] p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
                Theme {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeTheme(i)}
                className="font-mono text-[10px] text-muted hover:text-rose"
                disabled={pending}
                title="Remove this theme"
              >
                Remove ✕
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <input
                value={t.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Short title (e.g. FedRAMP High depth)"
                className="aur-input text-[12px]"
                maxLength={80}
              />
              <textarea
                value={t.statement}
                onChange={(e) => update(i, { statement: e.target.value })}
                placeholder="One-sentence statement the AI should weave into every relevant section"
                className="aur-input min-h-[72px] resize-y text-[12px]"
                maxLength={360}
              />
              <div className="text-right font-mono text-[9px] text-subtle">
                {t.statement.length}/360
              </div>
            </div>
          </li>
        ))}
      </ul>

      {themes.length < MAX_THEMES ? (
        <button
          type="button"
          onClick={addTheme}
          disabled={pending}
          className="mt-2 font-mono text-[10px] uppercase tracking-widest text-teal hover:text-text"
        >
          + Add theme
        </button>
      ) : (
        <div className="mt-2 font-mono text-[10px] text-subtle">
          Max {MAX_THEMES} themes — refine the ones above to add more.
        </div>
      )}

      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          Themes saved. Future AI drafts and scans will use them.
        </div>
      ) : null}
    </Panel>
  );
}
