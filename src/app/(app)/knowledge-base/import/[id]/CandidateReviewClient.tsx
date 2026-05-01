"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import {
  approveAllPendingForArtifactAction,
  approveCandidateAction,
  rejectCandidateAction,
  resetCandidateAction,
  startKnowledgeExtractionAction,
  type CandidateRow,
  type RunRow,
} from "./actions";
import { embedArtifactAction } from "../embed-actions";

const KIND_LABELS: Record<CandidateRow["kind"], string> = {
  capability: "Capability",
  past_performance: "Past performance",
  personnel: "Personnel",
  boilerplate: "Boilerplate",
};

const KIND_TONES: Record<CandidateRow["kind"], string> = {
  capability: "bg-teal-400/10 text-teal-300 border-teal-400/30",
  past_performance: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
  personnel: "bg-violet-400/10 text-violet-300 border-violet-400/30",
  boilerplate: "bg-amber-400/10 text-amber-200 border-amber-400/30",
};

export function CandidateReviewClient({
  artifactId,
  artifactStatus,
  rawTextChars,
  candidates,
  lastRun,
  rejectedCount,
}: {
  artifactId: string;
  artifactStatus: string;
  rawTextChars: number;
  candidates: CandidateRow[];
  lastRun: RunRow | null;
  rejectedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("pending");
  const [showRejected, setShowRejected] = useState(false);

  const pendingCandidates = candidates.filter((c) => c.decision === "pending");
  const approvedCandidates = candidates.filter(
    (c) => c.decision === "approved",
  );

  const visible = candidates.filter((c) => {
    if (filter === "all") return true;
    if (filter === "rejected") return c.decision === "rejected";
    return c.decision === filter;
  });

  function runExtraction() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await startKnowledgeExtractionAction(artifactId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        res.candidateCount === 0
          ? "Run completed — no candidates proposed."
          : `Run completed — ${res.candidateCount} candidate${res.candidateCount === 1 ? "" : "s"} ready to review.${res.stubbed ? " (stub mode)" : ""}`,
      );
      router.refresh();
    });
  }

  function embedNow() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await embedArtifactAction(artifactId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Embedded ${res.chunks} chunk${res.chunks === 1 ? "" : "s"} via ${res.provider}${res.stubbed ? " (stub)" : ""}.`,
      );
      router.refresh();
    });
  }

  function approveAll() {
    if (pendingCandidates.length === 0) return;
    if (
      !window.confirm(
        `Approve all ${pendingCandidates.length} pending candidate${
          pendingCandidates.length === 1 ? "" : "s"
        }? Each will be promoted into the knowledge base.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await approveAllPendingForArtifactAction(artifactId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`Approved ${res.approved} candidate${res.approved === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  const canRun =
    artifactStatus === "indexed" &&
    rawTextChars > 0 &&
    !pending;

  return (
    <Panel
      title="Brain extraction"
      eyebrow={
        lastRun
          ? `Last run · ${lastRun.status}${lastRun.provider ? ` · ${lastRun.provider}` : ""}${lastRun.candidateCount ? ` · ${lastRun.candidateCount} candidates` : ""}`
          : "No runs yet"
      }
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runExtraction}
            disabled={!canRun}
            className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
            title={
              !canRun
                ? "Wait for the artifact to finish indexing first."
                : "Run a Brain extraction pass over this artifact."
            }
          >
            {pending ? "Working…" : lastRun ? "Re-run extraction" : "Run extraction"}
          </button>
          {pendingCandidates.length > 0 ? (
            <button
              type="button"
              onClick={approveAll}
              disabled={pending}
              className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
            >
              Approve all {pendingCandidates.length}
            </button>
          ) : null}
          <button
            type="button"
            onClick={embedNow}
            disabled={!canRun}
            className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
            title="Index this artifact for semantic search."
          >
            {pending ? "…" : "Embed for search"}
          </button>
        </div>
      }
    >
      {!canRun && pending ? null : !canRun ? (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[11px] text-amber-200">
          {artifactStatus !== "indexed"
            ? `Artifact status is "${artifactStatus.replace(/_/g, " ")}". Wait for indexing to complete before running extraction.`
            : "Artifact has no extracted text yet. Re-upload if extraction failed."}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <div className="mt-3 font-mono text-[11px] text-muted">
          {lastRun?.status === "running"
            ? "Extraction running…"
            : 'No candidates yet. Click "Run extraction" to have the Brain read this artifact and propose knowledge entries.'}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FilterChip
              label={`Pending · ${pendingCandidates.length}`}
              active={filter === "pending"}
              onClick={() => setFilter("pending")}
            />
            <FilterChip
              label={`Approved · ${approvedCandidates.length}`}
              active={filter === "approved"}
              onClick={() => setFilter("approved")}
            />
            <FilterChip
              label={`All · ${candidates.length}`}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            {rejectedCount > 0 ? (
              <FilterChip
                label={`Rejected · ${rejectedCount}`}
                active={filter === "rejected"}
                onClick={() => setFilter("rejected")}
              />
            ) : null}
          </div>

          <ul className="mt-3 flex flex-col gap-3">
            {visible.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                disabled={pending}
                onApprove={(patch) => {
                  setError(null);
                  startTransition(async () => {
                    const r = await approveCandidateAction(c.id, patch);
                    if (!r.ok) setError(r.error);
                    else router.refresh();
                  });
                }}
                onReject={() => {
                  setError(null);
                  startTransition(async () => {
                    const r = await rejectCandidateAction(c.id);
                    if (!r.ok) setError(r.error);
                    else router.refresh();
                  });
                }}
                onReset={() => {
                  setError(null);
                  startTransition(async () => {
                    const r = await resetCandidateAction(c.id);
                    if (!r.ok) setError(r.error);
                    else router.refresh();
                  });
                }}
              />
            ))}
            {visible.length === 0 ? (
              <li className="font-mono text-[11px] text-muted">
                No candidates in this view.
              </li>
            ) : null}
          </ul>
        </>
      )}
    </Panel>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
        active
          ? "border-teal-400 bg-teal-400/15 text-teal"
          : "border-white/15 bg-white/[0.02] text-muted hover:border-white/30 hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function CandidateCard({
  candidate,
  disabled,
  onApprove,
  onReject,
  onReset,
}: {
  candidate: CandidateRow;
  disabled: boolean;
  onApprove: (patch?: { title?: string; body?: string; tags?: string[] }) => void;
  onReject: () => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(candidate.title);
  const [body, setBody] = useState(candidate.body);
  const [tagsText, setTagsText] = useState(candidate.tags.join(", "));

  const isPending = candidate.decision === "pending";
  const isApproved = candidate.decision === "approved";
  const isRejected = candidate.decision === "rejected";

  return (
    <li
      className={`rounded-lg border p-4 ${
        isApproved
          ? "border-emerald-400/30 bg-emerald-400/5"
          : isRejected
            ? "border-rose-400/20 bg-rose-400/5 opacity-60"
            : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${KIND_TONES[candidate.kind]}`}
          >
            {KIND_LABELS[candidate.kind]}
          </span>
          {isApproved ? (
            <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-emerald">
              ✓ Approved
            </span>
          ) : isRejected ? (
            <span className="rounded bg-rose-400/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-rose">
              Rejected
            </span>
          ) : null}
          {isApproved && candidate.promotedEntryId ? (
            <Link
              href={`/knowledge-base/${candidate.promotedEntryId}`}
              className="font-mono text-[10px] text-teal underline hover:no-underline"
            >
              Open entry →
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {isPending ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (editing) setEditing(false);
                  else setEditing(true);
                }}
                disabled={disabled}
                className="aur-btn aur-btn-ghost text-[10px] disabled:opacity-60"
              >
                {editing ? "Cancel edits" : "Edit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editing) {
                    onApprove({
                      title,
                      body,
                      tags: tagsText
                        .split(/[,;\n]+/)
                        .map((t) => t.trim().toLowerCase())
                        .filter(Boolean),
                    });
                  } else {
                    onApprove();
                  }
                }}
                disabled={disabled}
                className="aur-btn aur-btn-primary text-[10px] disabled:opacity-60"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={disabled}
                className="aur-btn aur-btn-ghost text-[10px] text-rose-300 disabled:opacity-60"
              >
                Reject
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onReset}
              disabled={disabled}
              className="aur-btn aur-btn-ghost text-[10px] disabled:opacity-60"
            >
              Re-open
            </button>
          )}
        </div>
      </div>

      {editing && isPending ? (
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <label className="aur-label">Title</label>
            <input
              className="aur-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="aur-label">Body</label>
            <textarea
              className="aur-input min-h-[120px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div>
            <label className="aur-label">Tags (comma-separated)</label>
            <input
              className="aur-input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 font-display text-[14px] font-semibold text-text">
            {candidate.title}
          </div>
          <div className="mt-1 whitespace-pre-wrap font-body text-[12px] leading-relaxed text-muted">
            {candidate.body}
          </div>
          {candidate.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {candidate.tags.map((t) => (
                <span
                  key={t}
                  className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}

      {candidate.sourceExcerpt ? (
        <details className="mt-3 rounded-lg border border-white/10 bg-white/[0.015] px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Evidence (source excerpt)
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted">
            {candidate.sourceExcerpt}
          </pre>
        </details>
      ) : null}
    </li>
  );
}
