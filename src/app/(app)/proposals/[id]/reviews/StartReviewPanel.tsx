"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ReviewColor } from "@/db/schema";
import { startReviewAction } from "./actions";

type ColorDef = { key: ReviewColor; label: string; color: string; description: string };
type Reviewer = { id: string; name: string | null; email: string; role: string };

export function StartReviewPanel({
  proposalId,
  colors,
  reviewers,
}: {
  proposalId: string;
  colors: ColorDef[];
  reviewers: Reviewer[];
}) {
  const router = useRouter();
  const [color, setColor] = useState<ReviewColor>("pink");
  const [dueDate, setDueDate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await startReviewAction({
        proposalId,
        color,
        dueDate: dueDate || null,
        reviewerUserIds: Array.from(selected),
      });
      if (!res.ok) return setError(res.error);
      setSelected(new Set());
      setDueDate("");
      router.push(`/proposals/${proposalId}/reviews/${res.reviewId}`);
    });
  }

  const colorDef = colors.find((c) => c.key === color);

  return (
    <Panel title="Start review" eyebrow="New color-team cycle">
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Color team</label>
          <select
            className="aur-input"
            value={color}
            onChange={(e) => setColor(e.target.value as ReviewColor)}
          >
            {colors.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {colorDef ? (
            <div className="mt-1 font-mono text-[10px] text-muted">
              {colorDef.description}
            </div>
          ) : null}
        </div>
        <div>
          <label className="aur-label">Due date (optional)</label>
          <input
            className="aur-input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Reviewers</label>
          {reviewers.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No org members to assign.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {reviewers.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5">
                    <input
                      type="checkbox"
                      className="accent-teal-400"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                    <span className="min-w-0 truncate font-mono text-[12px] text-text">
                      {r.name ?? r.email}
                    </span>
                    <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                      {r.role}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={pending || selected.size === 0}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Starting…" : `Start ${colorDef?.label ?? "review"}`}
        </button>
      </form>
    </Panel>
  );
}
