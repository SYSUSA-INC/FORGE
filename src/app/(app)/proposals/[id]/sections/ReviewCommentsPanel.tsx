"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  parseReviewBody,
  REVIEW_COLOR_LABELS,
  type SectionReviewComment,
} from "@/lib/review-comments";
import { resolveSectionReviewCommentAction } from "./review-comment-actions";

/**
 * BL-AIP-6b — the section's open colour-team review comments, human
 * and FORGE AI pre-review alike, inside the editor. Resolve here takes
 * the comment out of the review and out of the drafter's signals.
 */
export function ReviewCommentsPanel({
  proposalId,
  comments,
}: {
  proposalId: string;
  comments: SectionReviewComment[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = comments.filter((c) => !hidden.has(c.id));
  if (visible.length === 0) return null;

  async function resolve(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await resolveSectionReviewCommentAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setHidden((h) => new Set(h).add(id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve the comment.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-400/5">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200">
          ✎ Open review comments · {visible.length}
        </span>
        <span className="font-mono text-[10px] text-muted">Resolve here once the text answers them</span>
      </div>
      {error ? <p className="px-3 pb-2 font-mono text-[11px] text-rose-300">{error}</p> : null}
      <ul className="flex flex-col gap-1.5 border-t border-amber-400/15 p-3">
        {visible.map((c) => {
          const parsed = parseReviewBody(c.body);
          return (
            <li key={c.id} className="rounded border border-layer/10 bg-layer/[0.02] p-2">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-muted">
                <span className="rounded border border-layer/10 bg-layer/5 px-1.5 py-0.5">{REVIEW_COLOR_LABELS[c.color]}</span>
                {/* BL-FB-X-COLOR-TEAM Slice 3 — carried forward unresolved from an earlier round */}
                {c.carriedFrom ? (
                  <Link
                    href={`/proposals/${proposalId}/reviews/${c.carriedFrom.reviewId}`}
                    className="rounded border border-indigo-400/30 bg-indigo-400/5 px-1.5 py-0.5 text-indigo-300 hover:underline"
                    title="Still open when the earlier round closed; carried into this one. Opens the round it came from."
                  >
                    ↪ carried from {REVIEW_COLOR_LABELS[c.carriedFrom.color]}
                  </Link>
                ) : null}
                {c.authorName === null ? (
                  <span className="rounded border border-violet/40 bg-violet/10 px-1.5 py-0.5 text-text">FORGE AI</span>
                ) : (
                  <span>{c.authorName}</span>
                )}
                {parsed.severity ? (
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      parsed.severity === "high"
                        ? "border border-rose-300/40 bg-rose-300/10 text-rose-300"
                        : parsed.severity === "medium"
                          ? "border border-amber-400/40 bg-amber-400/10 text-amber-200"
                          : "border border-layer/10 bg-layer/5"
                    }`}
                  >
                    {parsed.severity}
                  </span>
                ) : null}
                <span className="ml-auto">{c.createdAt.slice(0, 10)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap font-body text-[12px] leading-relaxed text-text">{parsed.text}</p>
              <div className="mt-1.5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => resolve(c.id)}
                  disabled={busy !== null}
                  className="aur-btn aur-btn-ghost text-[10px] disabled:opacity-50"
                >
                  {busy === c.id ? "Resolving…" : "Resolve"}
                </button>
                <Link
                  href={`/proposals/${proposalId}/reviews/${c.reviewId}`}
                  className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
                >
                  Open review →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
