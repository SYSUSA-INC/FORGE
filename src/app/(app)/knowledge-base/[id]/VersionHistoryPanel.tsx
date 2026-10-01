"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { describeDelta } from "@/lib/content-blocks-logic";
import type { EntryVersionView } from "@/lib/entry-versions";
import { restoreEntryVersionAction } from "../actions";

/**
 * BL-FB-GEN-BLOCKS — the entry's changelog: one row per saved state,
 * newest first, with who, when, what changed and the note. Any older
 * version can be restored; the restore itself becomes the next version.
 */
export function VersionHistoryPanel({ id, versions }: { id: string; versions: EntryVersionView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const latest = versions[0]?.version ?? 0;

  if (versions.length === 0) {
    return (
      <p className="font-mono text-[11px] text-muted">
        No versions yet. The next save that changes the title, body or tags starts the history, keeping the current text as v1.
      </p>
    );
  }

  function restore(version: number) {
    if (!window.confirm(`Restore v${version}? The current text is kept as a version you can return to.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await restoreEntryVersionAction(id, version);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="font-mono text-[11px] text-rose-300">{error}</p> : null}
      <ol className="flex flex-col gap-1.5">
        {versions.map((v) => {
          const delta = describeDelta({
            wordsAdded: v.wordsAdded,
            wordsRemoved: v.wordsRemoved,
            titleChanged: false,
            tagsChanged: false,
          });
          const open = openVersion === v.version;
          return (
            <li key={v.id} className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted">
                <span className={`rounded px-1.5 py-0.5 ${v.version === latest ? "border border-emerald/40 bg-emerald/10 text-emerald" : "border border-layer/10 bg-layer/5"}`}>
                  v{v.version}
                  {v.version === latest ? " · current" : ""}
                </span>
                <span>{v.createdAt.slice(0, 10)}</span>
                {v.authorName ? <span>· {v.authorName}</span> : null}
                {delta ? <span>· {delta}</span> : null}
                <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
                  <button type="button" onClick={() => setOpenVersion(open ? null : v.version)} className="hover:text-text">
                    {open ? "Hide" : "Show"}
                  </button>
                  {v.version !== latest ? (
                    <button type="button" disabled={pending} onClick={() => restore(v.version)} className="hover:text-text disabled:opacity-50">
                      Restore
                    </button>
                  ) : null}
                </span>
              </div>
              {v.changeNote ? <p className="mt-1 font-body text-[12px] text-text">{v.changeNote}</p> : null}
              {open ? (
                <div className="mt-2 rounded border border-layer/10 bg-layer/[0.03] p-2">
                  <div className="font-display text-[12px] font-semibold text-text">{v.title}</div>
                  {v.tags.length ? <div className="mt-0.5 font-mono text-[10px] text-muted">{v.tags.join(", ")}</div> : null}
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-body text-[11px] leading-relaxed text-muted">{v.body}</pre>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
