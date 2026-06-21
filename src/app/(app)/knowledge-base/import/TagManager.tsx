"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTagAction, renameTagAction } from "./actions";

/**
 * BL-10 Phase C-2 — tag management surface.
 *
 * Lists every tag in use across the org's corpus with its usage count.
 * Each row supports inline rename (updates every artifact carrying the
 * tag) and delete (removes the tag from every artifact). Both actions
 * are race-safe via array_remove / array_append in the server actions.
 */

type Row = { tag: string; count: number };

export function TagManager({ tags }: { tags: Row[] }) {
  const [search, setSearch] = useState("");
  const filtered = tags.filter((t) =>
    search.trim() ? t.tag.includes(search.trim().toLowerCase()) : true,
  );

  if (tags.length === 0) {
    return (
      <p className="font-mono text-[11px] text-muted">
        No tags yet. Add tags during upload or by drag-dropping artifacts onto
        a tag bucket in &ldquo;By kind &amp; tag&rdquo; mode.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Filter ${tags.length} tag${tags.length === 1 ? "" : "s"}…`}
          className="aur-input text-[11px]"
        />
      </div>
      <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
        {filtered.map((r) => (
          <TagRow key={r.tag} tag={r.tag} count={r.count} />
        ))}
        {filtered.length === 0 ? (
          <li className="px-3 py-3 font-mono text-[11px] text-muted">
            No tags match &ldquo;{search}&rdquo;.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function TagRow({ tag, count }: { tag: string; count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag);
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (draft.trim().toLowerCase() === tag) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameTagAction(tag, draft);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    if (
      !window.confirm(
        `Remove tag "${tag}" from all ${count} artifact${count === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteTagAction(tag);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(tag);
                setEditing(false);
              }
            }}
            className="aur-input max-w-[260px] text-[11px]"
            disabled={pending}
          />
        ) : (
          <span className="rounded bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-text">
            #{tag}
          </span>
        )}
        <span className="font-mono text-[10px] text-subtle">
          {count} artifact{count === 1 ? "" : "s"}
        </span>
        {error ? (
          <span className="font-mono text-[10px] text-rose-300">{error}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={pending || !draft.trim()}
              className="aur-btn aur-btn-primary text-[10px] disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(tag);
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
              className="aur-btn aur-btn-ghost text-[10px]"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="aur-btn aur-btn-ghost text-[10px]"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="aur-btn aur-btn-ghost text-[10px] text-rose-300 disabled:opacity-60"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}
