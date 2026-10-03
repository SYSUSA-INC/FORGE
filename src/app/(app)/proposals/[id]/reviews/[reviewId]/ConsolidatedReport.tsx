"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { CommentGroup } from "@/lib/review-workflow-logic";

/**
 * BL-FB-X-COLOR-TEAM — comment consolidation: every reviewer's comments
 * folded into one per-section summary, with the Markdown report the
 * lead hands to the writers (or pastes into the debrief) in one click.
 */
export function ConsolidatedReport({
  groups,
  sectionNumbers,
  report,
}: {
  groups: CommentGroup[];
  sectionNumbers: Record<string, number>;
  report: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  const open = groups.reduce((n, g) => n + g.open.length, 0);

  return (
    <Panel
      title="Consolidated comments"
      eyebrow={`${open} open across ${groups.length} section${groups.length === 1 ? "" : "s"}`}
      actions={
        <button type="button" onClick={() => void copy()} className="aur-btn aur-btn-ghost text-[11px]" disabled={groups.length === 0} title="Copy the Markdown hand-off report">
          {copied ? "Copied" : "Copy report"}
        </button>
      }
    >
      {groups.length === 0 ? (
        <p className="font-body text-[12px] text-muted">Nothing to consolidate yet. Comments from every reviewer fold in here by section as they arrive.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {groups.map((g) => (
            <li key={g.sectionId ?? "general"} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-1.5">
              <span className="min-w-0 truncate font-mono text-[11px] text-text">
                {g.sectionId && sectionNumbers[g.sectionId] !== undefined ? `§${sectionNumbers[g.sectionId]} · ` : ""}
                {g.title}
              </span>
              <span className="font-mono text-[10px] text-muted">
                <span className={g.open.length > 0 ? "text-amber-200" : "text-emerald-300"}>{g.open.length} open</span> · {g.resolved.length} resolved · {g.authors.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? <div className="mt-2 font-mono text-[11px] text-rose-300">{error}</div> : null}
    </Panel>
  );
}
