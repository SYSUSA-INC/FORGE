"use client";

import { FormEvent, useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  addReviewCommentAction,
  deleteReviewCommentAction,
  toggleCommentResolvedAction,
} from "../actions";

type SectionRow = { id: string; title: string; ordering: number };

type CommentRow = {
  id: string;
  sectionId: string | null;
  userId: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
  authorName: string | null;
  authorEmail: string | null;
};

export function CommentsPanel({
  reviewId,
  proposalId,
  sections,
  comments,
  currentUserId,
  isSuperadmin,
}: {
  reviewId: string;
  proposalId: string;
  sections: SectionRow[];
  comments: CommentRow[];
  currentUserId: string;
  isSuperadmin: boolean;
}) {
  void proposalId;
  const router = useRouter();
  const [sectionFilter, setSectionFilter] = useState<string>("");
  const [showResolved, setShowResolved] = useState(false);
  const [body, setBody] = useState("");
  const [targetSectionId, setTargetSectionId] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sectionMap = useMemo(
    () => new Map(sections.map((s) => [s.id, s] as const)),
    [sections],
  );

  const filtered = comments.filter((c) => {
    if (!showResolved && c.resolved) return false;
    if (sectionFilter && c.sectionId !== sectionFilter) return false;
    return true;
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addReviewCommentAction({
        reviewId,
        sectionId: targetSectionId || null,
        body,
      });
      if (!res.ok) return setError(res.error);
      setBody("");
      router.refresh();
    });
  }

  function toggleResolved(c: CommentRow) {
    startTransition(async () => {
      const res = await toggleCommentResolvedAction({
        commentId: c.id,
        resolved: !c.resolved,
      });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  function remove(c: CommentRow) {
    if (!window.confirm("Delete this comment?")) return;
    startTransition(async () => {
      const res = await deleteReviewCommentAction(c.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Section comments"
      eyebrow={`${filtered.length} shown · ${comments.length} total`}
      actions={
        <div className="flex items-center gap-2">
          <select
            className="aur-input text-[11px]"
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
          >
            <option value="">All sections</option>
            <option value="__none">Unscoped</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ordering}. {s.title}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1 font-mono text-[11px] text-muted">
            <input
              type="checkbox"
              className="accent-teal-400"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Resolved
          </label>
        </div>
      }
    >
      <form
        className="mb-3 flex flex-col gap-2 rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3"
        onSubmit={onSubmit}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="aur-label">Section</label>
            <select
              className="aur-input"
              value={targetSectionId}
              onChange={(e) => setTargetSectionId(e.target.value)}
            >
              <option value="">No section (general)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.ordering}. {s.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="aur-label">Comment</label>
          <textarea
            className="aur-input min-h-[80px] resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What needs to change? What's strong? Be specific."
          />
        </div>
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        <div>
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="aur-btn aur-btn-primary py-2 text-[12px] disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add comment"}
          </button>
        </div>
      </form>

      {filtered.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">
          No comments {sectionFilter ? "in this section " : ""}
          {!showResolved ? "(unresolved) " : ""}yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((c) => {
            const sec = c.sectionId ? sectionMap.get(c.sectionId) : null;
            const canDelete = c.userId === currentUserId || isSuperadmin;
            return (
              <li
                key={c.id}
                className={`rounded-md border p-2.5 ${
                  c.resolved
                    ? "border-white/10 bg-white/[0.015] opacity-60"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                    {sec
                      ? `§${sec.ordering} · ${sec.title}`
                      : "General"}
                  </span>
                  <div className="flex items-center gap-3 font-mono text-[10px] text-muted">
                    <span>{c.authorName ?? c.authorEmail ?? "Unknown"}</span>
                    <span>{new Date(c.createdAt).toLocaleString()}</span>
                    <button
                      type="button"
                      className="uppercase tracking-widest hover:text-text"
                      disabled={pending}
                      onClick={() => toggleResolved(c)}
                    >
                      {c.resolved ? "Reopen" : "Resolve"}
                    </button>
                    {canDelete ? (
                      <button
                        type="button"
                        className="uppercase tracking-widest hover:text-rose"
                        disabled={pending}
                        onClick={() => remove(c)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1.5 whitespace-pre-wrap font-body text-[13px] text-text">
                  {c.body}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
