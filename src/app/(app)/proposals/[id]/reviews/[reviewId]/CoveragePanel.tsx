"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { describeCoverage, sectionCoverage } from "@/lib/review-workflow-logic";
import { setReviewerSectionsAction } from "../actions";

type SectionRow = { id: string; title: string; ordering: number };
type Reviewer = { userId: string; name: string | null; email: string };

/**
 * BL-FB-X-COLOR-TEAM — who reads which section this round. One tick
 * per reviewer per section; a reviewer with no ticks reads the whole
 * proposal. Sections nobody covers are called out so the lead fixes
 * them before the reviewers start.
 */
export function CoveragePanel({
  reviewId,
  sections,
  reviewers,
  sectionAssignments,
  currentUserId,
  canEdit,
}: {
  reviewId: string;
  sections: SectionRow[];
  reviewers: Reviewer[];
  sectionAssignments: { userId: string; sectionId: string }[];
  currentUserId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const coverage = sectionCoverage({ sections, reviewerIds: reviewers.map((r) => r.userId), sectionAssignments });
  const uncovered = new Set(coverage.uncovered);
  const whole = new Set(coverage.wholeProposalReviewerIds);

  function toggle(userId: string, sectionId: string) {
    const mine = new Set(sectionAssignments.filter((a) => a.userId === userId).map((a) => a.sectionId));
    if (mine.has(sectionId)) mine.delete(sectionId);
    else mine.add(sectionId);
    setError(null);
    startTransition(async () => {
      const res = await setReviewerSectionsAction({ reviewId, userId, sectionIds: Array.from(mine) });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  if (sections.length === 0 || reviewers.length === 0) return null;

  return (
    <Panel title="Section coverage" eyebrow={describeCoverage(coverage)} dense>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-layer/10">
              <th className="px-3 py-2 text-left font-normal uppercase tracking-[0.2em] text-subtle">Section</th>
              {reviewers.map((r) => (
                <th key={r.userId} className="px-2 py-2 text-center font-normal text-muted" title={r.email}>
                  <span className={r.userId === currentUserId ? "text-text" : ""}>{(r.name ?? r.email.split("@")[0]) || "?"}</span>
                  {whole.has(r.userId) ? <div className="text-[9px] uppercase tracking-widest text-subtle">all</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => {
              const bare = uncovered.has(s.id);
              return (
                <tr key={s.id} className={`border-b border-layer/5 ${bare ? "bg-amber-400/5" : ""}`}>
                  <td className="px-3 py-1.5 text-text">
                    §{s.ordering}. {s.title}
                    {bare ? <span className="ml-2 rounded border border-amber-400/40 bg-amber-400/10 px-1 py-0.5 text-[9px] uppercase tracking-widest text-amber-200">no reviewer</span> : null}
                  </td>
                  {reviewers.map((r) => {
                    const scoped = sectionAssignments.some((a) => a.userId === r.userId && a.sectionId === s.id);
                    return (
                      <td key={r.userId} className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          className="accent-teal-400 disabled:opacity-50"
                          checked={scoped}
                          disabled={!canEdit || pending}
                          onChange={() => toggle(r.userId, s.id)}
                          aria-label={`${r.name ?? r.email} reviews §${s.ordering}`}
                          title={whole.has(r.userId) && !scoped ? "Reads the whole proposal; tick to narrow to sections" : undefined}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="font-body text-[11px] text-muted">No ticks in a column means that reviewer reads the whole proposal.</span>
        {error ? <span className="font-mono text-[11px] text-rose-300">{error}</span> : null}
      </div>
    </Panel>
  );
}
