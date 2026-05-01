"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveKnowledgeArtifactAction,
  deleteKnowledgeArtifactAction,
  type ListedArtifact,
} from "./actions";

export function ArtifactRow({ artifact }: { artifact: ListedArtifact }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function archive() {
    startTransition(async () => {
      await archiveKnowledgeArtifactAction(artifact.id, !artifact.archivedAt);
      router.refresh();
    });
  }

  function remove() {
    if (
      !window.confirm(
        `Delete "${artifact.title}" from the corpus? This cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteKnowledgeArtifactAction(artifact.id);
      router.refresh();
    });
  }

  const statusTone =
    artifact.status === "indexed"
      ? "bg-emerald-500/15 text-emerald-300"
      : artifact.status === "failed"
        ? "bg-rose-500/15 text-rose-300"
        : artifact.status === "extracting_text"
          ? "bg-amber-500/15 text-amber-200"
          : "bg-white/5 text-muted";

  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-display text-[14px] font-semibold text-text">
            {artifact.title || artifact.fileName || "Untitled"}
          </span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
            {formatKind(artifact.kind)}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${statusTone}`}
          >
            {artifact.status.replace(/_/g, " ")}
          </span>
          {artifact.archivedAt ? (
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
              archived
            </span>
          ) : null}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted">
          {artifact.fileName} · {formatBytes(artifact.fileSize)} ·{" "}
          {formatChars(artifact.charCount)} chars indexed ·{" "}
          {new Date(artifact.uploadedAt).toLocaleDateString()}
        </div>
        {artifact.tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {artifact.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
        {artifact.statusError ? (
          <div className="mt-1 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 font-mono text-[10px] text-rose-300">
            {artifact.statusError}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <a
          href={`/knowledge-base/import/${artifact.id}`}
          className="aur-btn aur-btn-primary text-[10px]"
          title="Run Brain extraction on this artifact"
        >
          Open
        </a>
        <button
          type="button"
          onClick={archive}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[10px] disabled:opacity-60"
        >
          {artifact.archivedAt ? "Restore" : "Archive"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[10px] text-rose-300 disabled:opacity-60"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatChars(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}
