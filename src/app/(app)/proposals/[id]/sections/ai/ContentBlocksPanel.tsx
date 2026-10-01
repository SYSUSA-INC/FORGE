"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { collectTags, filterBlocks, type ContentBlockView } from "@/lib/content-blocks-logic";
import { listContentBlocksAction, recordBlockUseAction } from "./block-actions";

/**
 * BL-FB-GEN-BLOCKS — "Insert a content block": the org's boilerplate
 * entries, filtered by tag or text, dropped into the section as a
 * tracked insertion. Loads on first open; an insertion bumps the
 * block's reuse counter so the library knows what is actually used.
 */
export function ContentBlocksPanel({
  proposalId,
  sectionId,
  onInsert,
}: {
  proposalId: string;
  sectionId: string;
  /** Receives the block's text to drop into the section editor. */
  onInsert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [blocks, setBlocks] = useState<ContentBlockView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [inserted, setInserted] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listContentBlocksAction();
      if (res.ok) setBlocks(res.blocks);
      else setError(res.error);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && blocks === null && !loading) void load();
  }

  const tags = useMemo(() => collectTags(blocks ?? []), [blocks]);
  const visible = useMemo(() => filterBlocks(blocks ?? [], { query, tag }), [blocks, query, tag]);

  function insert(block: ContentBlockView) {
    onInsert(block.body.trim() + "\n\n");
    setInserted(block.id);
    void recordBlockUseAction({ entryId: block.id, proposalId, sectionId }).then((res) => {
      if (res.ok) {
        setBlocks((list) => (list ?? []).map((b) => (b.id === block.id ? { ...b, reuseCount: res.reuseCount } : b)));
      }
    });
  }

  return (
    <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300">
          ▣ Insert a content block{blocks ? ` · ${blocks.length}` : ""}
        </span>
        <span className="font-mono text-[10px] text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="border-t border-emerald-400/15 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="aur-input min-w-[220px] flex-1"
              placeholder="Filter blocks by title, tag or text…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter content blocks"
            />
            <button type="button" onClick={() => void load()} disabled={loading} className="aur-btn aur-btn-ghost text-[10px]" title="Reload">
              {loading ? "Loading…" : "Reload"}
            </button>
          </div>
          {tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setTag(null)}
                className={`aur-chip ${tag === null ? "border-emerald-400/40 text-emerald-300" : "hover:text-text"}`}
              >
                all
              </button>
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTag(tag === t ? null : t)}
                  className={`aur-chip ${tag === t ? "border-emerald-400/40 text-emerald-300" : "hover:text-text"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-1 font-mono text-[10px] text-muted">
            Blocks are the <span className="text-text">Boilerplate</span> entries under Knowledge, version-controlled with a changelog.
            Inserted text arrives as a tracked suggestion by FORGE AI.
          </p>

          {error ? (
            <div className="mt-3 rounded border border-rose/40 bg-rose/10 px-2 py-1 font-mono text-[11px] text-rose">{error}</div>
          ) : null}

          {blocks !== null ? (
            blocks.length === 0 ? (
              <div className="mt-3 font-mono text-[11px] text-muted">
                No content blocks yet. Save reusable text as a Boilerplate entry under{" "}
                <Link href="/knowledge-base/new" className="text-text underline">
                  Knowledge → New knowledge entry
                </Link>{" "}
                and it appears here.
              </div>
            ) : visible.length === 0 ? (
              <div className="mt-3 font-mono text-[11px] text-muted">No block matches that filter.</div>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {visible.map((b) => (
                  <BlockRow key={b.id} block={b} justInserted={inserted === b.id} onInsert={() => insert(b)} />
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BlockRow({
  block,
  justInserted,
  onInsert,
}: {
  block: ContentBlockView;
  justInserted: boolean;
  onInsert: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-lg border border-layer/10 bg-layer/[0.02] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate font-display text-[12px] font-semibold text-text">{block.title}</span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted">
            {block.version > 0 ? `v${block.version} · ` : ""}used {block.reuseCount}×
          </span>
          {block.tags.slice(0, 4).map((t) => (
            <span key={t} className="aur-chip">
              {t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/knowledge-base/${block.id}`}
            className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
            title="Open the entry and its version history"
          >
            History
          </Link>
          <button
            type="button"
            onClick={onInsert}
            className="aur-btn aur-btn-ghost text-[10px]"
            title="Append this block to the section as a tracked suggestion"
          >
            {justInserted ? "Inserted ✓" : "Insert"}
          </button>
        </div>
      </div>
      <div
        className={`mt-1 whitespace-pre-wrap font-body text-[11px] leading-relaxed text-muted ${expanded ? "" : "max-h-16 overflow-hidden"}`}
      >
        {block.body}
      </div>
      {block.body.length > 200 ? (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 font-mono text-[10px] text-emerald-300 hover:underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </li>
  );
}
