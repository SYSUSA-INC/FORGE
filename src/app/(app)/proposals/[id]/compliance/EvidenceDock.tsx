"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ComplianceEvidenceKind } from "@/db/schema";
import {
  attachComplianceEvidenceAction,
  detachComplianceEvidenceAction,
  listAvailableEvidenceAction,
  type AvailableEvidence,
  type EvidenceRow,
} from "./actions";

const KIND_LABELS: Record<ComplianceEvidenceKind, string> = {
  past_performance: "Past performance",
  knowledge_entry: "Knowledge",
  section_paragraph: "Section paragraph",
};

const KIND_COLORS: Record<ComplianceEvidenceKind, string> = {
  past_performance: "#34d399",
  knowledge_entry: "#a78bfa",
  section_paragraph: "#fbbf24",
};

type Tab = ComplianceEvidenceKind;

export function EvidenceDock({
  proposalId,
  itemId,
  evidence,
}: {
  proposalId: string;
  itemId: string;
  evidence: EvidenceRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [available, setAvailable] = useState<AvailableEvidence | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("past_performance");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );

  function loadIfNeeded() {
    if (available || pending) return;
    setLoadError(null);
    startTransition(async () => {
      const res = await listAvailableEvidenceAction(proposalId);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setAvailable(res.data);
      if (res.data.sections.length > 0 && !selectedSectionId) {
        setSelectedSectionId(res.data.sections[0]!.id);
      }
    });
  }

  function attach(input: {
    kind: ComplianceEvidenceKind;
    refId: string;
    label: string;
    snippet: string;
  }) {
    setAttachError(null);
    startTransition(async () => {
      const res = await attachComplianceEvidenceAction({
        proposalId,
        itemId,
        ...input,
      });
      if (!res.ok) {
        setAttachError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function detach(evidenceId: string) {
    setAttachError(null);
    startTransition(async () => {
      const res = await detachComplianceEvidenceAction(evidenceId);
      if (!res.ok) {
        setAttachError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) loadIfNeeded();
        }}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted hover:text-text"
      >
        {open ? "▼" : "▶"} Evidence ({evidence.length})
      </button>

      {evidence.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {evidence.map((e) => {
            const color = KIND_COLORS[e.kind];
            return (
              <li
                key={e.id}
                className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5"
              >
                <span
                  className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
                  style={{
                    color,
                    background: `${color}1a`,
                    border: `1px solid ${color}40`,
                  }}
                >
                  {KIND_LABELS[e.kind]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-mono text-[11px] text-text">
                    {e.label || "(no label)"}
                  </div>
                  {e.snippet ? (
                    <div className="mt-0.5 line-clamp-2 font-body text-[11px] text-muted">
                      {e.snippet}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => detach(e.id)}
                  disabled={pending}
                  className="shrink-0 font-mono text-[10px] text-rose hover:text-rose/70 disabled:opacity-50"
                  title="Remove this evidence"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open ? (
        <div className="mt-2 rounded-md border border-teal/30 bg-teal/[0.04] p-2">
          {loadError ? (
            <div className="rounded border border-rose/40 bg-rose/10 px-2 py-1 font-mono text-[10px] text-rose">
              {loadError}
            </div>
          ) : null}
          {attachError ? (
            <div className="mb-2 rounded border border-rose/40 bg-rose/10 px-2 py-1 font-mono text-[10px] text-rose">
              {attachError}
            </div>
          ) : null}

          {!available && !loadError ? (
            <div className="font-mono text-[10px] text-muted">Loading…</div>
          ) : null}

          {available ? (
            <>
              <div className="mb-2 flex gap-1 rounded border border-white/10 p-0.5">
                {(
                  [
                    "past_performance",
                    "knowledge_entry",
                    "section_paragraph",
                  ] as Tab[]
                ).map((tab) => {
                  const count =
                    tab === "past_performance"
                      ? available.pastPerformance.length
                      : tab === "knowledge_entry"
                        ? available.knowledgeEntries.length
                        : available.sections.length;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                        activeTab === tab
                          ? "bg-teal/15 text-teal"
                          : "text-muted hover:text-text"
                      }`}
                    >
                      {KIND_LABELS[tab]} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="max-h-[260px] overflow-y-auto">
                {activeTab === "past_performance" ? (
                  available.pastPerformance.length === 0 ? (
                    <div className="font-mono text-[10px] text-muted">
                      No past performance entries on this org yet. Add some
                      under{" "}
                      <code className="text-text">
                        /settings/organization
                      </code>
                      .
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {available.pastPerformance.map((pp) => {
                        const label =
                          pp.contract
                            ? `${pp.customer} — ${pp.contract}`
                            : pp.customer || "(unnamed)";
                        return (
                          <li
                            key={pp.refId}
                            className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-[11px] text-text">
                                  {label}
                                </div>
                                {pp.description ? (
                                  <div className="mt-0.5 line-clamp-2 font-body text-[11px] text-muted">
                                    {pp.description}
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() =>
                                  attach({
                                    kind: "past_performance",
                                    refId: pp.refId,
                                    label,
                                    snippet: pp.description,
                                  })
                                }
                                className="aur-btn aur-btn-ghost shrink-0 text-[10px] disabled:opacity-50"
                              >
                                Attach
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}

                {activeTab === "knowledge_entry" ? (
                  available.knowledgeEntries.length === 0 ? (
                    <div className="font-mono text-[10px] text-muted">
                      No knowledge entries yet. Build the Brain under{" "}
                      <code className="text-text">/knowledge</code>.
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {available.knowledgeEntries.map((k) => (
                        <li
                          key={k.id}
                          className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-white/5 px-1 py-0.5 font-mono text-[9px] uppercase text-muted">
                                  {k.kind}
                                </span>
                                <span className="truncate font-mono text-[11px] text-text">
                                  {k.title}
                                </span>
                              </div>
                              <div className="mt-0.5 line-clamp-2 font-body text-[11px] text-muted">
                                {k.body}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                attach({
                                  kind: "knowledge_entry",
                                  refId: k.id,
                                  label: k.title,
                                  snippet: k.body.slice(0, 500),
                                })
                              }
                              className="aur-btn aur-btn-ghost shrink-0 text-[10px] disabled:opacity-50"
                            >
                              Attach
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}

                {activeTab === "section_paragraph" ? (
                  available.sections.length === 0 ? (
                    <div className="font-mono text-[10px] text-muted">
                      No proposal sections yet. Add sections under{" "}
                      <code className="text-text">
                        /proposals/[id]/sections
                      </code>
                      .
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedSectionId ?? ""}
                        onChange={(e) => setSelectedSectionId(e.target.value)}
                        className="mb-2 w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-text"
                      >
                        {available.sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.ordering}. {s.title}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const section = available.sections.find(
                          (s) => s.id === selectedSectionId,
                        );
                        if (!section) return null;
                        if (section.contentSnippets.length === 0) {
                          return (
                            <div className="font-mono text-[10px] text-muted">
                              Section has no paragraphs long enough to cite.
                              Add content to the section first.
                            </div>
                          );
                        }
                        return (
                          <ul className="flex flex-col gap-1">
                            {section.contentSnippets.map((p, i) => (
                              <li
                                key={i}
                                className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="line-clamp-3 flex-1 font-body text-[11px] text-foreground">
                                    {p}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() =>
                                      attach({
                                        kind: "section_paragraph",
                                        refId: section.id,
                                        label: `${section.title} ¶${i + 1}`,
                                        snippet: p,
                                      })
                                    }
                                    className="aur-btn aur-btn-ghost shrink-0 text-[10px] disabled:opacity-50"
                                  >
                                    Attach
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </>
                  )
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
