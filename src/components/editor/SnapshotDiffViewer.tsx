"use client";

/**
 * BL-9 Slice 5c — diff viewer modal.
 *
 * Compares two TipTap docs (snapshot vs. current, or two snapshots)
 * at the projected plain-text level. The diff is computed locally
 * with the `diff` package (jsdiff) so no extra server round-trip is
 * needed beyond fetching each side's body_doc.
 *
 * `diffWordsWithSpace` gives an inline word-level diff which reads
 * better than line-level for prose paragraphs — common edits like
 * "fix typo" only highlight the changed word rather than the whole
 * line. Whitespace-only changes still register so the user sees
 * paragraph reflows.
 *
 * Rendering is unified (single column, +/-/context coloring) rather
 * than side-by-side; that keeps the layout readable on narrow
 * screens and matches the in-app aesthetic.
 */

import { diffWordsWithSpace, type Change } from "diff";
import { useEffect, useMemo, useState } from "react";
import type { TipTapDoc } from "@/db/schema";
import { projectToPlain } from "@/lib/tiptap-doc";
import {
  getSectionSnapshotBodyAction,
  type SectionSnapshotSummary,
} from "@/app/(app)/proposals/[id]/sections/snapshot-actions";

type Props = {
  proposalId: string;
  sectionId: string;
  snapshotId: string;
  snapshotMeta: SectionSnapshotSummary;
  /** The current section body shown alongside the snapshot. */
  currentBodyDoc: TipTapDoc;
  onClose: () => void;
};

export function SnapshotDiffViewer({
  proposalId,
  sectionId,
  snapshotId,
  snapshotMeta,
  currentBodyDoc,
  onClose,
}: Props) {
  const [fromText, setFromText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSectionSnapshotBodyAction({ proposalId, sectionId, snapshotId })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          setLoading(false);
          return;
        }
        setFromText(projectToPlain(res.bodyDoc));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Diff load failed.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proposalId, sectionId, snapshotId]);

  // Esc closes the modal.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toText = useMemo(() => projectToPlain(currentBodyDoc), [currentBodyDoc]);

  const changes: Change[] = useMemo(() => {
    if (fromText === null) return [];
    return diffWordsWithSpace(fromText, toText);
  }, [fromText, toText]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      if (c.added) added += countWords(c.value);
      else if (c.removed) removed += countWords(c.value);
    }
    return { added, removed };
  }, [changes]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-lg border border-white/10 bg-canvas p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-mono text-[12px] uppercase tracking-[0.2em] text-text">
              Snapshot diff
            </h3>
            <p className="font-mono text-[10px] text-muted">
              <span className="text-rose">−</span>{" "}
              {snapshotMeta.label || (snapshotMeta.kind === "auto" ? "checkpoint" : "manual")}
              {" "}
              <span className="text-subtle">
                · {snapshotMeta.createdByName || "Unknown"} ·{" "}
                {formatTimestamp(snapshotMeta.createdAt)}
              </span>
              <span className="mx-2 text-subtle">vs.</span>
              <span className="text-emerald">+</span> current
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="aur-btn-ghost text-[10px]"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="font-mono text-[11px] text-muted">Loading diff…</p>
        ) : error ? (
          <p className="font-mono text-[10px] text-rose">{error}</p>
        ) : (
          <>
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <span className="text-emerald">+{stats.added} words</span>
              <span className="text-rose">−{stats.removed} words</span>
              {stats.added === 0 && stats.removed === 0 && (
                <span className="text-muted">No textual changes.</span>
              )}
            </div>
            <div className="overflow-y-auto rounded border border-white/10 bg-white/[0.02] p-3 font-mono text-[12px] leading-relaxed">
              {changes.length === 0 ? (
                <p className="text-muted">Documents are identical.</p>
              ) : (
                <DiffOutput changes={changes} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DiffOutput({ changes }: { changes: Change[] }) {
  return (
    <pre className="whitespace-pre-wrap break-words">
      {changes.map((c, idx) => {
        if (c.added) {
          return (
            <span
              key={idx}
              style={{
                background: "rgba(74, 222, 128, 0.20)",
                color: "#86EFAC",
              }}
            >
              {c.value}
            </span>
          );
        }
        if (c.removed) {
          return (
            <span
              key={idx}
              style={{
                background: "rgba(248, 113, 113, 0.20)",
                color: "#FCA5A5",
                textDecoration: "line-through",
                textDecorationColor: "rgba(248, 113, 113, 0.6)",
              }}
            >
              {c.value}
            </span>
          );
        }
        return (
          <span key={idx} className="text-text">
            {c.value}
          </span>
        );
      })}
    </pre>
  );
}

function countWords(s: string): number {
  let n = 0;
  let inWord = false;
  for (const ch of s) {
    const isWordChar = /[\p{L}\p{N}]/u.test(ch);
    if (isWordChar && !inWord) {
      n += 1;
      inWord = true;
    } else if (!isWordChar) {
      inWord = false;
    }
  }
  return n;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
