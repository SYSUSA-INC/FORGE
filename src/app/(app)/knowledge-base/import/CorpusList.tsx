"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArtifactRow } from "./ArtifactRow";
import {
  setArtifactKindAction,
  setArtifactTagsAction,
  type ListedArtifact,
} from "./actions";
import type { KnowledgeArtifactKind } from "@/db/schema";

/**
 * BL-10 Phase C-2 — corpus tree with nested grouping + drag-drop reclassification.
 *
 * Three group modes:
 *   - "none" — flat newest-first list (original behavior)
 *   - "kind" — single-level grouping by artifact kind (Phase C-1)
 *   - "kind+tag" — nested: kind buckets → tag sub-buckets → artifacts
 *
 * Drag-drop:
 *   - Drag an artifact card onto a kind header → calls setArtifactKindAction
 *     to re-classify, then refreshes the route.
 *   - Drag an artifact card onto a tag sub-bucket → appends that tag to the
 *     artifact's tag array (deduped server-side), then refreshes.
 *
 * Uses HTML5 native drag-and-drop — no extra library on the dep tree.
 */

type GroupMode = "none" | "kind" | "kind+tag";

const ALL_KINDS: KnowledgeArtifactKind[] = [
  "proposal",
  "rfp",
  "contract",
  "cpars",
  "debrief",
  "capability_brief",
  "resume",
  "brochure",
  "whitepaper",
  "email",
  "note",
  "image",
  "spreadsheet",
  "deck",
  "other",
];

const DRAG_MIME = "application/x-forge-artifact";

export function CorpusList({ artifacts }: { artifacts: ListedArtifact[] }) {
  const [mode, setMode] = useState<GroupMode>("none");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ── Build bucketed views once per [mode, artifacts] change ─────────────
  const grouped = useMemo(() => {
    if (mode === "none") return null;
    const buckets = new Map<string, ListedArtifact[]>();
    for (const a of artifacts) {
      const list = buckets.get(a.kind) ?? [];
      list.push(a);
      buckets.set(a.kind, list);
    }
    return Array.from(buckets.entries()).sort(
      (x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]),
    );
  }, [artifacts, mode]);

  if (artifacts.length === 0) {
    return (
      <div className="font-mono text-[11px] text-muted">
        Empty. Upload a file to seed the corpus.
      </div>
    );
  }

  // ── Drop handlers ───────────────────────────────────────────────────────
  function changeKind(artifactId: string, kind: KnowledgeArtifactKind) {
    setError(null);
    startTransition(async () => {
      const res = await setArtifactKindAction(artifactId, kind);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function addTag(artifactId: string, tag: string) {
    setError(null);
    const a = artifacts.find((x) => x.id === artifactId);
    if (!a) return;
    if (a.tags.includes(tag.toLowerCase())) return;
    startTransition(async () => {
      const next = [...a.tags, tag];
      const res = await setArtifactTagsAction(artifactId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Group by
        </span>
        <div className="flex gap-1">
          <GroupToggle
            label="Flat"
            active={mode === "none"}
            onClick={() => setMode("none")}
          />
          <GroupToggle
            label="By kind"
            active={mode === "kind"}
            onClick={() => setMode("kind")}
          />
          <GroupToggle
            label="By kind & tag"
            active={mode === "kind+tag"}
            onClick={() => setMode("kind+tag")}
          />
        </div>
        {mode !== "none" ? (
          <span className="ml-1 font-mono text-[10px] text-subtle">
            drag a card onto a header to reclassify
          </span>
        ) : null}
        {pending ? (
          <span className="ml-1 font-mono text-[10px] text-muted">
            saving…
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 font-mono text-[11px] text-rose-300">
          {error}
        </div>
      ) : null}

      {mode === "none" || !grouped ? (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {artifacts.map((a) => (
            <DraggableRow key={a.id} artifact={a} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([kind, rows]) => (
            <KindGroup
              key={kind}
              kind={kind as KnowledgeArtifactKind}
              rows={rows}
              showTagSubBuckets={mode === "kind+tag"}
              onDropArtifact={(id) => changeKind(id, kind as KnowledgeArtifactKind)}
              onDropOnTag={addTag}
            />
          ))}
          {/* Empty-kind targets so the user can drag into a currently empty bucket */}
          <EmptyKindTargets
            existing={new Set(grouped.map(([k]) => k))}
            onDropArtifact={changeKind}
          />
        </div>
      )}
    </div>
  );
}

function GroupToggle({
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
      className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
        active
          ? "bg-teal-400/15 text-teal-300"
          : "bg-white/5 text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

// ── Draggable artifact row ─────────────────────────────────────────────────

function DraggableRow({ artifact }: { artifact: ListedArtifact }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => {
        // Both formats — Firefox sometimes won't fire drop without text/plain.
        e.dataTransfer.setData(DRAG_MIME, artifact.id);
        e.dataTransfer.setData("text/plain", artifact.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={`cursor-grab active:cursor-grabbing transition-opacity ${dragging ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
    >
      <ArtifactRow artifact={artifact} />
    </div>
  );
}

// ── Kind bucket with optional nested tag sub-buckets ──────────────────────

function KindGroup({
  kind,
  rows,
  showTagSubBuckets,
  onDropArtifact,
  onDropOnTag,
}: {
  kind: KnowledgeArtifactKind;
  rows: ListedArtifact[];
  showTagSubBuckets: boolean;
  onDropArtifact: (artifactId: string) => void;
  onDropOnTag: (artifactId: string, tag: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [hoverDrop, setHoverDrop] = useState(false);

  function readArtifactId(e: React.DragEvent): string | null {
    return (
      e.dataTransfer.getData(DRAG_MIME) ||
      e.dataTransfer.getData("text/plain") ||
      null
    );
  }

  // Tag sub-buckets: deterministic order by count desc, name asc.
  const tagBuckets = useMemo(() => {
    if (!showTagSubBuckets) return null;
    const m = new Map<string, ListedArtifact[]>();
    const untagged: ListedArtifact[] = [];
    for (const a of rows) {
      if (a.tags.length === 0) {
        untagged.push(a);
        continue;
      }
      for (const t of a.tags) {
        const list = m.get(t) ?? [];
        list.push(a);
        m.set(t, list);
      }
    }
    const sorted = Array.from(m.entries()).sort(
      (x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]),
    );
    return { tags: sorted, untagged };
  }, [rows, showTagSubBuckets]);

  return (
    <div
      className={`rounded-lg border transition-colors ${
        hoverDrop
          ? "border-teal-400/60 bg-teal-400/[0.05]"
          : "border-white/10"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setHoverDrop(true);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the whole container; not on child crossings.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHoverDrop(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setHoverDrop(false);
        const id = readArtifactId(e);
        if (id) onDropArtifact(id);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-white/10 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted">
            {open ? "▾" : "▸"}
          </span>
          <span className="font-display text-[13px] font-semibold text-text">
            {formatKind(kind)}
          </span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </button>

      {open ? (
        showTagSubBuckets && tagBuckets ? (
          <div className="flex flex-col gap-2 p-2">
            {tagBuckets.tags.map(([tag, taggedRows]) => (
              <TagSubBucket
                key={tag}
                tag={tag}
                rows={taggedRows}
                onDropOnTag={(id) => onDropOnTag(id, tag)}
              />
            ))}
            {tagBuckets.untagged.length > 0 ? (
              <UntaggedSubBucket rows={tagBuckets.untagged} />
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map((a) => (
              <DraggableRow key={a.id} artifact={a} />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function TagSubBucket({
  tag,
  rows,
  onDropOnTag,
}: {
  tag: string;
  rows: ListedArtifact[];
  onDropOnTag: (artifactId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [hoverDrop, setHoverDrop] = useState(false);

  return (
    <div
      className={`rounded border transition-colors ${
        hoverDrop
          ? "border-amber-400/60 bg-amber-400/[0.05]"
          : "border-white/[0.06]"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setHoverDrop(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHoverDrop(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setHoverDrop(false);
        const id =
          e.dataTransfer.getData(DRAG_MIME) ||
          e.dataTransfer.getData("text/plain");
        if (id) onDropOnTag(id);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted">
            {open ? "▾" : "▸"}
          </span>
          <span className="font-mono text-[11px] text-text">#{tag}</span>
        </span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-subtle">
          {rows.length}
        </span>
      </button>
      {open ? (
        <ul className="divide-y divide-white/5 border-t border-white/[0.05]">
          {rows.map((a) => (
            <DraggableRow key={a.id} artifact={a} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function UntaggedSubBucket({ rows }: { rows: ListedArtifact[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-white/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted">
            {open ? "▾" : "▸"}
          </span>
          <span className="font-mono text-[11px] italic text-muted">
            (untagged)
          </span>
        </span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-subtle">
          {rows.length}
        </span>
      </button>
      {open ? (
        <ul className="divide-y divide-white/5 border-t border-white/[0.05]">
          {rows.map((a) => (
            <DraggableRow key={a.id} artifact={a} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Compact drop targets for kinds with zero artifacts in the current
 * corpus. Lets a user move an artifact into a previously-empty bucket
 * without leaving the tree view. Each pill is its own drop zone.
 */
function EmptyKindTargets({
  existing,
  onDropArtifact,
}: {
  existing: Set<string>;
  onDropArtifact: (artifactId: string, kind: KnowledgeArtifactKind) => void;
}) {
  const missing = ALL_KINDS.filter((k) => !existing.has(k));
  if (missing.length === 0) return null;
  return (
    <div className="rounded-lg border border-dashed border-white/10 p-2">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
        Empty kinds — drop here to reclassify
      </div>
      <div className="flex flex-wrap gap-1">
        {missing.map((k) => (
          <EmptyKindPill
            key={k}
            kind={k}
            onDropArtifact={(id) => onDropArtifact(id, k)}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyKindPill({
  kind,
  onDropArtifact,
}: {
  kind: KnowledgeArtifactKind;
  onDropArtifact: (artifactId: string) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <span
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        const id =
          e.dataTransfer.getData(DRAG_MIME) ||
          e.dataTransfer.getData("text/plain");
        if (id) onDropArtifact(id);
      }}
      className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
        hover
          ? "bg-teal-400/20 text-teal-200 border border-teal-400/60"
          : "bg-white/[0.04] text-muted border border-white/10"
      }`}
    >
      {formatKind(kind)}
    </span>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}
