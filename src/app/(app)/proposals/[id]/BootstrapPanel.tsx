"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ProposalBootstrapRecord } from "@/db/schema";
import { bootstrapProposalAction } from "../actions";

/**
 * BL-AIP-5b — what the AI read in Section L and applied to this
 * proposal, with a way to build or rebuild the outline. Written
 * sections are never removed by a rebuild.
 */
export function BootstrapPanel({
  proposalId,
  record,
  hasSectionL,
}: {
  proposalId: string;
  record: ProposalBootstrapRecord | null;
  hasSectionL: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string>("");

  function run() {
    setNote("");
    startTransition(async () => {
      const res = await bootstrapProposalAction(proposalId);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setNote(
        `${res.sections} sections from Section L · ${res.inserted} added, ${res.updated} refreshed, ${res.removed} empty removed, ${res.kept} written kept` +
          (res.themesSeeded ? " · win themes proposed" : "") +
          (res.dueDateSet ? " · due date set" : ""),
      );
      router.refresh();
    });
  }

  const applied = record?.applied;
  return (
    <Panel
      title="Outline from Section L"
      eyebrow={
        record
          ? `Built ${record.generatedAt.slice(0, 10)} · ${record.sections.length} sections · prompt ${record.promptVersion}`
          : hasSectionL
            ? "Not built yet"
            : "No parsed solicitation with instructions on this opportunity"
      }
      actions={
        hasSectionL ? (
          <button
            type="button"
            className="aur-btn aur-btn-ghost text-[11px]"
            disabled={pending}
            onClick={run}
            title="Read Section L again and refresh the outline. Sections with text are kept."
          >
            {pending ? "Reading Section L…" : record ? "Rebuild outline" : "Build outline"}
          </button>
        ) : null
      }
    >
      {note ? <p className="mb-2 font-mono text-[11px] text-muted">{note}</p> : null}
      {!record ? (
        <p className="font-mono text-[11px] text-muted">
          {hasSectionL
            ? "Build the outline the instructions to offerors ask for: sections in order with page caps and a brief each, the due date, and proposed win themes. Sections that already have text are kept."
            : "Upload and parse the solicitation on this opportunity first."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {record.sections.map((s, i) => (
              <li
                key={`${s.title}-${i}`}
                className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-text">
                    {i + 1}. {s.title}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                    {s.kind.replace(/_/g, " ")}
                    {s.pageLimit ? ` · ${s.pageLimit} pp` : ""}
                    {s.sourceRef ? ` · ${s.sourceRef}` : ""}
                  </span>
                </div>
                {s.instructions ? (
                  <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">{s.instructions}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted md:grid-cols-4">
            <div>
              <dt className="text-muted/70">Due date</dt>
              <dd className="text-text">
                {record.dueDate ?? "not stated"}
                {applied?.dueDateSet ? " · set" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted/70">Themes proposed</dt>
              <dd className="text-text">
                {record.proposedThemes.length}
                {applied?.themesSeeded ? " · seeded" : record.proposedThemes.length ? " · kept yours" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted/70">Applied</dt>
              <dd className="text-text">
                {applied
                  ? `${applied.sectionsInserted} added · ${applied.sectionsUpdated} refreshed · ${applied.sectionsRemoved} removed · ${applied.sectionsKept} kept`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted/70">Mode</dt>
              <dd className="text-text">{applied?.mode ?? "—"}</dd>
            </div>
          </dl>
          {record.proposedThemes.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 font-mono text-[11px] text-muted">
              {record.proposedThemes.map((t) => (
                <li key={t.title}>
                  <span className="text-text">{t.title}</span> — {t.statement}
                  {t.rationale ? <span className="text-muted/70"> ({t.rationale})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {record.notes ? (
            <p className="mt-3 font-body text-[12px] leading-relaxed text-muted">{record.notes}</p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
