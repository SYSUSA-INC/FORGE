"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { KnowledgeKind } from "@/db/schema";
import {
  archiveKnowledgeEntryAction,
  deleteKnowledgeEntryAction,
  unarchiveKnowledgeEntryAction,
  updateKnowledgeEntryAction,
} from "../actions";

const KINDS: KnowledgeKind[] = [
  "capability",
  "past_performance",
  "personnel",
  "boilerplate",
];

export function EditEntryClient({
  id,
  initial,
}: {
  id: string;
  initial: {
    kind: KnowledgeKind;
    title: string;
    body: string;
    tags: string[];
    archived: boolean;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [kind, setKind] = useState<KnowledgeKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [tagsRaw, setTagsRaw] = useState(initial.tags.join(", "));

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const tags = tagsRaw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await updateKnowledgeEntryAction(id, {
        kind,
        title,
        body,
        tags,
      });
      if (!res.ok) return setError(res.error);
      setNotice("Saved.");
      router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      const res = await archiveKnowledgeEntryAction(id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }
  function unarchive() {
    startTransition(async () => {
      const res = await unarchiveKnowledgeEntryAction(id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }
  function remove() {
    if (
      !window.confirm(`Delete "${title}"? This cannot be undone.`)
    )
      return;
    startTransition(async () => {
      const res = await deleteKnowledgeEntryAction(id);
      if (!res.ok) return setError(res.error);
      router.push("/knowledge-base");
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={save}>
      <div>
        <label className="aur-label" htmlFor="kb-kind">
          Kind
        </label>
        <select
          id="kb-kind"
          className="aur-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as KnowledgeKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="aur-label" htmlFor="kb-title">
          Title
        </label>
        <input
          id="kb-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="aur-input"
        />
      </div>
      <div>
        <label className="aur-label" htmlFor="kb-body">
          Body
        </label>
        <textarea
          id="kb-body"
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="aur-input min-h-[240px] resize-y font-body text-[13px] leading-relaxed"
        />
      </div>
      <div>
        <label className="aur-label" htmlFor="kb-tags">
          Tags
        </label>
        <input
          id="kb-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          className="aur-input"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {initial.archived ? (
            <button
              type="button"
              disabled={pending}
              onClick={unarchive}
              className="aur-btn aur-btn-ghost"
            >
              Restore from archive
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={archive}
              className="aur-btn aur-btn-ghost"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={remove}
            className="aur-btn aur-btn-danger"
          >
            Delete
          </button>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="aur-btn aur-btn-primary disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
