"use client";

import { useState, useTransition } from "react";
import {
  brainSuggestForSectionAction,
  type BrainHit,
} from "./brain-actions";

export function BrainSuggestPanel({
  sectionId,
  onInsert,
}: {
  sectionId: string;
  /** Receives plain text the writer wants to drop into the section editor. */
  onInsert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BrainHit[] | null>(null);
  const [stubbed, setStubbed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  function suggest() {
    setError(null);
    setHits(null);
    startPending(async () => {
      const res = await brainSuggestForSectionAction(sectionId, query);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setHits(res.hits);
      setStubbed(res.stubbed);
    });
  }

  return (
    <div className="rounded-lg border border-violet-400/20 bg-violet-400/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-violet-300">
          ✦ Suggest from Brain
        </span>
        <span className="font-mono text-[10px] text-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-violet-400/15 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="aur-input flex-1 min-w-[240px]"
              placeholder="Optional — narrow the search (e.g. 'past zero-trust on Navy')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  suggest();
                }
              }}
            />
            <button
              type="button"
              onClick={suggest}
              disabled={pending}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
            >
              {pending ? "Thinking…" : "Suggest"}
            </button>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted">
            Searches the corpus + curated entries using the section's title,
            kind, and opportunity context.
            {stubbed
              ? " · Stub mode — set OPENAI_API_KEY for real semantic match."
              : ""}
          </div>

          {error ? (
            <div className="mt-3 rounded border border-rose/40 bg-rose/10 px-2 py-1 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}

          {hits !== null ? (
            hits.length === 0 ? (
              <div className="mt-3 font-mono text-[11px] text-muted">
                No relevant material in the corpus or knowledge base. Drop more
                artifacts at <span className="text-text">/knowledge-base/import</span>{" "}
                and try again.
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {hits.map((h) => (
                  <HitRow key={h.id} hit={h} onInsert={onInsert} />
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HitRow({
  hit,
  onInsert,
}: {
  hit: BrainHit;
  onInsert: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sim = Math.max(0, Math.min(1, hit.similarity));

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <SourceTag hit={hit} />
          <span className="truncate font-display text-[12px] font-semibold text-text">
            {hit.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
            style={{
              color: simColor(sim),
              backgroundColor: `${simColor(sim)}1A`,
              border: `1px solid ${simColor(sim)}40`,
            }}
            title={`${(sim * 100).toFixed(1)}% similarity`}
          >
            {Math.round(sim * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onInsert(hit.content.trim() + "\n\n")}
            className="aur-btn aur-btn-ghost text-[10px]"
            title="Insert this passage at the end of the current section"
          >
            Insert
          </button>
        </div>
      </div>
      <div
        className={`mt-1 whitespace-pre-wrap font-body text-[11px] leading-relaxed text-muted ${
          expanded ? "" : "max-h-20 overflow-hidden"
        }`}
      >
        {hit.content}
      </div>
      {hit.content.length > 240 ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 font-mono text-[10px] text-violet-300 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </li>
  );
}

function SourceTag({ hit }: { hit: BrainHit }) {
  if (hit.source === "entry") {
    const labels: Record<NonNullable<BrainHit["entryKind"]>, string> = {
      capability: "Capability",
      past_performance: "Past performance",
      personnel: "Personnel",
      boilerplate: "Boilerplate",
    };
    return (
      <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-emerald-300">
        {labels[hit.entryKind ?? "capability"]} · curated
      </span>
    );
  }
  return (
    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
      {hit.artifactKind?.replace(/_/g, " ") ?? "artifact"}
    </span>
  );
}

function simColor(s: number): string {
  if (s >= 0.85) return "#10B981";
  if (s >= 0.7) return "#34D399";
  if (s >= 0.55) return "#2DD4BF";
  if (s >= 0.4) return "#A78BFA";
  return "#94A3B8";
}
