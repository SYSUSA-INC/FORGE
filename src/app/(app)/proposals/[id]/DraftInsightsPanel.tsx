import { Panel } from "@/components/ui/Panel";
import { getDraftInsightsAction } from "./draft-insights-actions";
import { REVIEW_COLOR_LABELS } from "@/lib/review-types";
import { withAlpha, THEME } from "@/lib/theme-colors";
import type { ReviewColor } from "@/db/schema";

const KIND_LABELS: Record<string, string> = {
  executive_summary: "Exec. Summary",
  technical: "Technical",
  management: "Management",
  past_performance: "Past Perf.",
  pricing: "Pricing",
  compliance: "Compliance",
};

const KIND_NAMES: Record<string, string> = {
  executive_summary: "Executive summary",
  technical: "Technical",
  management: "Management",
  past_performance: "Past performance",
  pricing: "Pricing",
  compliance: "Compliance",
};

function StyleList({ label, items, quoted }: { label: string; items: string[]; quoted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-label text-subtle">{label}</span>
      {quoted ? (
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item} className="font-body text-[11px] leading-relaxed text-muted">
              &ldquo;{item}&rdquo;
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-[11px] leading-relaxed text-muted">{items.join(" · ")}</p>
      )}
    </div>
  );
}

function colorLabel(color: string): string {
  return REVIEW_COLOR_LABELS[color as ReviewColor] ?? color;
}

function fractionBadge(fraction: number | null) {
  if (fraction === null) return null;
  const pct = Math.round(fraction * 100);
  const color =
    pct >= 70 ? THEME.green : pct >= 40 ? THEME.brass : THEME.red;
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[10px]"
      style={{
        color,
        backgroundColor: withAlpha(color, 0.1),
        border: `1px solid ${withAlpha(color, 0.25)}`,
      }}
    >
      {pct}%
    </span>
  );
}

export async function DraftInsightsPanel({
  proposalId,
}: {
  proposalId: string;
}) {
  const result = await getDraftInsightsAction(proposalId);
  if (
    !result.ok ||
    (result.data.totalDrafts === 0 &&
      result.data.editDecisions.total === 0 &&
      result.data.editDecisions.aiDecisions === 0 &&
      result.data.retention.now === null &&
      result.data.retention.reviews.length === 0 &&
      result.data.styleNotes.length === 0)
  ) {
    return null;
  }

  const { data } = result;

  return (
    <Panel
      title="AI Draft Insights"
      eyebrow={`${data.totalDrafts} draft${data.totalDrafts !== 1 ? "s" : ""} · ${data.resolvedDrafts} resolved`}
    >
      <div className="flex flex-col gap-3">
        {/* Overall retention score */}
        <div className="flex items-center justify-between rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
          <span className="font-body text-[12px] text-muted">
            Overall AI content retained
          </span>
          <div className="flex items-center gap-2">
            {fractionBadge(data.overallAvgFraction)}
            <span className="font-mono text-[10px] text-subtle">
              avg across {data.resolvedDrafts} reviewed draft
              {data.resolvedDrafts !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Per-section-kind breakdown */}
        {data.kindStats.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-label text-subtle">
              By section type
            </span>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {data.kindStats.map((s) => (
                <div
                  key={s.sectionKind}
                  className="flex items-center justify-between gap-2 rounded border border-layer/10 bg-layer/[0.02] px-2 py-1.5"
                >
                  <span className="font-mono text-[10px] text-muted">
                    {KIND_LABELS[s.sectionKind] ?? s.sectionKind}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {fractionBadge(s.avgAcceptedFraction)}
                    <span className="font-mono text-[10px] text-subtle">
                      ×{s.draftCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* BL-NAV-LIFECYCLE 5d — the AI's first draft, through each review */}
        {data.retention.now || data.retention.reviews.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
            <span className="font-body text-[12px] text-muted">
              AI first draft kept, through each review
            </span>
            <ul className="flex flex-col gap-1">
              {data.retention.reviews.map((r) => (
                <li key={r.reviewId} className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted">
                  <span>
                    At {colorLabel(r.color)}
                    {r.startedAt ? ` · ${new Date(r.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {fractionBadge(r.keptShare)}
                    <span className="text-subtle">
                      {r.sections} section{r.sections !== 1 ? "s" : ""}
                    </span>
                  </span>
                </li>
              ))}
              {data.retention.now ? (
                <li className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted">
                  <span>Now</span>
                  <span className="flex items-center gap-1.5">
                    {fractionBadge(data.retention.now.keptShare)}
                    <span className="text-subtle">
                      {data.retention.now.sections} section{data.retention.now.sections !== 1 ? "s" : ""}
                    </span>
                  </span>
                </li>
              ) : null}
            </ul>
            <p className="font-body text-[11px] leading-relaxed text-subtle">
              For sections Auto-draft wrote: how much of that draft was still
              in the text when each review round started, weighted by the
              length of each draft. The draft itself is kept in the
              section&apos;s Snapshots as &quot;AI draft&quot;.
            </p>
          </div>
        ) : null}

        {/* BL-NAV-LIFECYCLE 5d — reviewers' tracked suggestions, by colour team */}
        {data.reviewerDecisions.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
            <span className="font-body text-[12px] text-muted">
              Reviewers&apos; suggestions accepted
            </span>
            <ul className="flex flex-col gap-1">
              {data.reviewerDecisions.map((r) => (
                <li key={r.color} className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted">
                  <span>{colorLabel(r.color)}</span>
                  <span className="flex items-center gap-1.5">
                    {fractionBadge(r.acceptRate)}
                    <span className="text-subtle">{r.decided} decided</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* BL-NAV-LIFECYCLE 5d-2 — the organization's style notes */}
        {data.styleNotes.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
            <span className="font-body text-[12px] text-muted">How your team writes</span>
            {data.styleNotes.map((note) => (
              <details key={note.sectionKind} className="border-t border-layer/10 pt-1.5">
                <summary className="flex cursor-pointer items-center justify-between gap-2 font-mono text-[10px] text-muted">
                  <span>{KIND_NAMES[note.sectionKind] ?? note.sectionKind}</span>
                  <span className="text-subtle">
                    {note.body.sampleSize} edits
                    {note.body.reviewerDecisions > 0 ? ` · ${note.body.reviewerDecisions} from reviewers` : ""}
                    {` · ${new Date(note.builtAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                  </span>
                </summary>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <StyleList label="Wording preferred" items={note.body.preferredWording} />
                  <StyleList label="Wording cut" items={note.body.avoidedWording} />
                  <StyleList label="Added and kept" items={note.body.added.slice(0, 3)} quoted />
                  <StyleList label="Cut" items={note.body.cut.slice(0, 3)} quoted />
                  <StyleList label="Dropped from AI drafts" items={note.body.droppedFromAiDrafts.slice(0, 3)} quoted />
                </div>
              </details>
            ))}
            <p className="font-body text-[11px] leading-relaxed text-subtle">
              Rebuilt every week from your organization&apos;s own tracked
              changes and reviewers&apos; suggestions over the last 180 days,
              one note per kind of section, once a kind has five decisions.
              The drafter reads the note for the kind of section it is
              writing. It is never shared with another organization.
            </p>
          </div>
        ) : null}

        {/* A/B stats */}
        {data.abComparisonCount > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-teal/20 bg-teal/[0.03] px-3 py-2">
            <span className="font-body text-[12px] text-muted">
              A/B comparisons —{" "}
              <span className="font-mono">
                {data.abComparisonCount} comparison
                {data.abComparisonCount !== 1 ? "s" : ""}
              </span>
            </span>
            {data.abVariantBWinRate !== null ? (
              <span className="font-mono text-[10px] text-teal">
                alt. variant chosen{" "}
                {Math.round(data.abVariantBWinRate * 100)}% of the time
              </span>
            ) : null}
          </div>
        ) : null}

        {/* BL-AIX Phase 0b — how owners judge FORGE AI's own suggestions */}
        {data.editDecisions.aiDecisions > 0 ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-indigo/20 bg-indigo/[0.03] px-3 py-2">
            <span className="font-body text-[12px] text-muted">
              FORGE AI suggestions accepted
            </span>
            <div className="flex items-center gap-2">
              {fractionBadge(data.editDecisions.aiAcceptRate)}
              <span className="font-mono text-[10px] text-subtle">
                by words · {data.editDecisions.aiDecisions} decided
              </span>
            </div>
          </div>
        ) : null}

        {/* BL-9 Slice 7 — track-changes decisions */}
        {data.editDecisions.total > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-body text-[12px] text-muted">
                Teammates&apos; suggestions
              </span>
              <span className="font-mono text-[10px] text-subtle">
                {data.editDecisions.total} resolved
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted">
              <span className="flex items-center gap-1.5">
                insertions kept{" "}
                {fractionBadge(data.editDecisions.insertAcceptRate) ?? (
                  <span className="text-subtle">—</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                deletions kept{" "}
                {fractionBadge(data.editDecisions.deleteAcceptRate) ?? (
                  <span className="text-subtle">—</span>
                )}
              </span>
            </div>
            <p className="font-body text-[11px] leading-relaxed text-subtle">
              The drafter reads these decisions: phrasing owners keep becomes
              the register to match, struck text becomes what to avoid.
            </p>
          </div>
        ) : null}

        <p className="font-body text-[11px] leading-relaxed text-subtle">
          Retention is measured once a draft has been reviewed (no open
          suggestions, at least 30 minutes after it was written) by how many of
          its phrases survive. Accept-all counts at half weight. Use the A/B
          Compare button in the section editor to let the Brain compete with
          itself.
        </p>
      </div>
    </Panel>
  );
}
