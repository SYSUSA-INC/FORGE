import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { LESSON_KIND_LABELS, type LessonKind } from "@/lib/lessons";
import { lessonsForContext } from "@/lib/lessons-read";
import { safeQuery } from "@/lib/schema-resilience";

/**
 * BL-LESSONS-LOOP phase 4b — the confirmed lessons that bear on this
 * pursuit (same agency or NAICS), each with the bid it came from, beside
 * the scorecard. Renders nothing when none applies.
 */
export async function LessonsThatApplyPanel({ agency, naicsCode }: { agency: string; naicsCode: string }) {
  const { organizationId } = await requireCurrentOrg();
  const lessons = await safeQuery(() => lessonsForContext(organizationId, { agency, naicsCode }), [], { tag: "evaluation.lessons" });
  if (lessons.length === 0) return null;
  return (
    <Panel
      title="Lessons that apply"
      eyebrow={`${lessons.length} confirmed · same agency or NAICS`}
      actions={
        <Link href="/intelligence/lessons" className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text">
          All lessons →
        </Link>
      }
    >
      <ul className="flex flex-col divide-y divide-layer/10">
        {lessons.map((l) => {
          const kind = (l.kind as LessonKind) ?? "do";
          return (
            <li key={l.id} className="flex flex-wrap items-baseline gap-2 py-1.5 font-body text-[13px]">
              <span className={`font-mono text-[10px] uppercase tracking-label ${kind === "avoid" ? "text-rose" : kind === "watch" ? "text-brass" : "text-green"}`}>{LESSON_KIND_LABELS[kind]}</span>
              <span className="min-w-0 flex-1 text-text">{l.text}</span>
              {l.fromProposalId ? (
                <Link href={`/proposals/${l.fromProposalId}/outcome`} className="aur-link text-[12px]">
                  from {l.fromTitle}
                </Link>
              ) : (
                <span className="text-[12px] text-muted">from {l.fromTitle}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
