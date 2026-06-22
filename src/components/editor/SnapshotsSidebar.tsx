"use client";

/**
 * BL-9 Slice 5b — sidebar for per-section version snapshots.
 *
 * Loads the snapshot list on mount (and whenever the parent bumps
 * `reloadKey`), shows manual + auto-stage-transition snapshots
 * newest-first, and exposes a "snapshot now" form for the current
 * user. Owners can restore (which itself snapshots first, so the
 * restore is reversible) or delete; non-owners see a read-only list.
 *
 * The component is intentionally form-driven rather than chatty —
 * the server actions write audit rows, so each restore / delete /
 * create is already accountable.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  createSectionSnapshotAction,
  deleteSectionSnapshotAction,
  listSectionSnapshotsAction,
  restoreSectionSnapshotAction,
  type SectionSnapshotSummary,
} from "@/app/(app)/proposals/[id]/sections/snapshot-actions";

type Props = {
  proposalId: string;
  sectionId: string;
  visible: boolean;
  isOwner?: boolean;
  /** Bumped by the parent after a save to force a fresh fetch. */
  reloadKey?: number;
  /** Fired after a successful restore so the parent can re-render the editor. */
  onRestored?: () => void;
};

export function SnapshotsSidebar({
  proposalId,
  sectionId,
  visible,
  isOwner = true,
  reloadKey = 0,
  onRestored,
}: Props) {
  const [snapshots, setSnapshots] = useState<SectionSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listSectionSnapshotsAction({ proposalId, sectionId });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSnapshots(res.snapshots);
  }, [proposalId, sectionId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, reloadKey, load]);

  if (!visible) return null;

  function takeSnapshot() {
    startTransition(async () => {
      const res = await createSectionSnapshotAction({
        proposalId,
        sectionId,
        label,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLabel("");
      await load();
    });
  }

  function restore(id: string) {
    if (!isOwner) return;
    const confirmed = window.confirm(
      "Restore this snapshot? The current content will be saved as an automatic snapshot first so you can undo this.",
    );
    if (!confirmed) return;
    startTransition(async () => {
      const res = await restoreSectionSnapshotAction({
        proposalId,
        sectionId,
        snapshotId: id,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await load();
      onRestored?.();
    });
  }

  function remove(id: string) {
    if (!isOwner) return;
    const confirmed = window.confirm("Delete this snapshot? This cannot be undone.");
    if (!confirmed) return;
    startTransition(async () => {
      const res = await deleteSectionSnapshotAction({
        proposalId,
        sectionId,
        snapshotId: id,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await load();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Snapshots
        </span>
        <span className="font-mono text-[9px] text-subtle">
          {snapshots.length} total
        </span>
      </div>

      <div className="flex items-end gap-1.5">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              takeSnapshot();
            }
          }}
          placeholder="Optional label — e.g. before rewrite"
          maxLength={120}
          className="aur-input flex-1 text-[11px]"
        />
        <button
          type="button"
          onClick={takeSnapshot}
          disabled={pending}
          className="aur-btn-primary text-[10px] disabled:opacity-40"
        >
          {pending ? "Saving…" : "Snapshot"}
        </button>
      </div>

      {error && (
        <p className="font-mono text-[10px] text-rose">{error}</p>
      )}

      {loading ? (
        <p className="font-mono text-[11px] text-muted">Loading…</p>
      ) : snapshots.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          No snapshots yet. Take one to checkpoint the current text.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {snapshots.map((s) => (
            <SnapshotRow
              key={s.id}
              snapshot={s}
              canResolve={isOwner}
              onRestore={() => restore(s.id)}
              onDelete={() => remove(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SnapshotRow({
  snapshot,
  canResolve,
  onRestore,
  onDelete,
}: {
  snapshot: SectionSnapshotSummary;
  canResolve: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const isAuto = snapshot.kind === "auto";
  const created = formatTimeAgo(new Date(snapshot.createdAt).getTime());
  const author = snapshot.createdByName || "Unknown";

  return (
    <li className="flex flex-col gap-1 rounded border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={
              isAuto
                ? {
                    background: "rgba(94, 234, 212, 0.10)",
                    border: "1px solid rgba(94, 234, 212, 0.25)",
                    color: "#5EEAD4",
                  }
                : {
                    background: "rgba(251, 191, 36, 0.10)",
                    border: "1px solid rgba(251, 191, 36, 0.25)",
                    color: "#FBBF24",
                  }
            }
          >
            {isAuto ? "auto" : "manual"}
          </span>
          <span className="truncate font-mono text-[10px] text-text">
            {snapshot.label || (isAuto ? "checkpoint" : "manual snapshot")}
          </span>
        </div>
        {canResolve && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onRestore}
              title="Restore this snapshot (current text saved first)"
              className="rounded border border-teal/30 bg-teal/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-teal hover:bg-teal/20 transition-colors"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={onDelete}
              title="Delete this snapshot"
              className="rounded border border-rose/30 bg-rose/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose hover:bg-rose/20 transition-colors"
            >
              ✕
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[9px] text-subtle">
        <span>{author}</span>
        <span>·</span>
        <span>{created}</span>
        <span>·</span>
        <span>{snapshot.wordCount} words</span>
      </div>
    </li>
  );
}

function formatTimeAgo(tsMs: number): string {
  const diff = Date.now() - tsMs;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
