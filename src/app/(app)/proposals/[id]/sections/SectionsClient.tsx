"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ProposalSectionKind,
  ProposalSectionStatus,
} from "@/db/schema";
import {
  SECTION_KIND_LABELS,
  SECTION_STATUS_COLORS,
  SECTION_STATUS_LABELS,
} from "@/lib/proposal-types";
import {
  addCustomSectionAction,
  removeSectionAction,
  saveSectionAction,
} from "../../actions";

type Section = {
  id: string;
  kind: ProposalSectionKind;
  title: string;
  ordering: number;
  content: string;
  status: ProposalSectionStatus;
  wordCount: number;
  pageLimit: number | null;
  authorUserId: string | null;
  authorName: string | null;
  authorEmail: string | null;
};

type TeamMember = { id: string; name: string | null; email: string };

const STATUSES: ProposalSectionStatus[] = [
  "not_started",
  "in_progress",
  "draft_complete",
  "in_review",
  "approved",
];

const KIND_OPTIONS: ProposalSectionKind[] = [
  "technical",
  "management",
  "past_performance",
  "pricing",
  "compliance",
  "executive_summary",
];

export function SectionsClient({
  proposalId,
  sections,
  team,
}: {
  proposalId: string;
  sections: Section[];
  team: TeamMember[];
}) {
  const [expanded, setExpanded] = useState<string | null>(
    sections[0]?.id ?? null,
  );

  return (
    <div className="flex flex-col gap-3">
      <AddSectionRow proposalId={proposalId} />

      <ul className="flex flex-col gap-2">
        {sections.map((s) => (
          <SectionRow
            key={s.id}
            proposalId={proposalId}
            section={s}
            team={team}
            open={expanded === s.id}
            onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function AddSectionRow({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ProposalSectionKind>("technical");
  const [error, setError] = useState<string | null>(null);

  function onSubmit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addCustomSectionAction({
        proposalId,
        kind,
        title,
      });
      if (!res.ok) return setError(res.error);
      setTitle("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 md:flex-row md:items-end">
      <div className="flex-1">
        <label className="aur-label">Add section</label>
        <input
          className="aur-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Volume III – Key Personnel"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>
      <div className="md:w-48">
        <label className="aur-label">Kind</label>
        <select
          className="aur-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as ProposalSectionKind)}
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {SECTION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="aur-btn aur-btn-ghost text-[12px] md:w-32"
        disabled={pending || !title.trim()}
        onClick={onSubmit}
      >
        {pending ? "Adding…" : "+ Add"}
      </button>
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[10px] text-rose md:w-full">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SectionRow({
  proposalId,
  section,
  team,
  open,
  onToggle,
}: {
  proposalId: string;
  section: Section;
  team: TeamMember[];
  open: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [title, setTitle] = useState(section.title);
  const [content, setContent] = useState(section.content);
  const [status, setStatus] = useState<ProposalSectionStatus>(section.status);
  const [pageLimit, setPageLimit] = useState<string>(
    section.pageLimit === null ? "" : String(section.pageLimit),
  );
  const [authorUserId, setAuthorUserId] = useState<string>(
    section.authorUserId ?? "",
  );

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await saveSectionAction({
        proposalId,
        sectionId: section.id,
        title,
        content,
        status,
        pageLimit: pageLimit.trim() === "" ? null : Number(pageLimit),
        authorUserId: authorUserId || null,
      });
      if (!res.ok) return setError(res.error);
      setNotice("Saved.");
      router.refresh();
    });
  }

  function remove() {
    if (
      !window.confirm(`Remove section "${section.title}"? This cannot be undone.`)
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await removeSectionAction(proposalId, section.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <li className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
              {section.ordering}
            </span>
            <span className="truncate font-display text-[14px] font-semibold text-text">
              {section.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            <span>{SECTION_KIND_LABELS[section.kind]}</span>
            <span>·</span>
            <span>{section.wordCount} words</span>
            {section.pageLimit ? (
              <>
                <span>·</span>
                <span>{section.pageLimit}p cap</span>
              </>
            ) : null}
            {section.authorName || section.authorEmail ? (
              <>
                <span>·</span>
                <span>{section.authorName ?? section.authorEmail}</span>
              </>
            ) : null}
          </div>
        </div>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
          style={{
            color: SECTION_STATUS_COLORS[section.status],
            backgroundColor: `${SECTION_STATUS_COLORS[section.status]}1A`,
            border: `1px solid ${SECTION_STATUS_COLORS[section.status]}40`,
          }}
        >
          {SECTION_STATUS_LABELS[section.status]}
        </span>
        <span className="shrink-0 text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="border-t border-white/10 bg-canvas/40 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label">Section title</label>
              <input
                className="aur-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="aur-label">Status</label>
                <select
                  className="aur-input"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as ProposalSectionStatus)
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {SECTION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="aur-label">Page cap</label>
                <input
                  className="aur-input"
                  inputMode="numeric"
                  value={pageLimit}
                  onChange={(e) => setPageLimit(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div>
                <label className="aur-label">Author</label>
                <select
                  className="aur-input"
                  value={authorUserId}
                  onChange={(e) => setAuthorUserId(e.target.value)}
                >
                  <option value="">—</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <label className="aur-label">Content</label>
              <span className="font-mono text-[10px] text-muted">
                {words} words
              </span>
            </div>
            <textarea
              className="aur-input min-h-[320px] resize-y font-body text-[13px] leading-relaxed"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Draft prose here. Markdown-style is fine."
            />
          </div>

          {error ? (
            <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mt-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
              {notice}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="aur-btn aur-btn-primary text-[12px]"
              disabled={pending}
              onClick={save}
            >
              {pending ? "Saving…" : "Save section"}
            </button>
            <button
              type="button"
              className="aur-btn aur-btn-danger text-[11px]"
              disabled={pending}
              onClick={remove}
            >
              Remove section
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
