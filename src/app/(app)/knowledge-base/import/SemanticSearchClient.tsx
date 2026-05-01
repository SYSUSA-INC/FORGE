"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  reembedMissingArtifactsAction,
  semanticSearchAction,
  type SearchHit,
} from "./embed-actions";

export function SemanticSearchClient({
  initialStatus,
}: {
  initialStatus: {
    chunkCount: number;
    artifactCount: number;
    provider: string;
    providerReason: string;
    stub: boolean;
  };
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchStubbed, setSearchStubbed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reembedNotice, setReembedNotice] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  const [reembedPending, startReembed] = useTransition();

  function search() {
    setError(null);
    setReembedNotice(null);
    setHits(null);
    if (query.trim().length < 3) {
      setError("Type at least 3 characters.");
      return;
    }
    startPending(async () => {
      const res = await semanticSearchAction(query);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setHits(res.hits);
      setSearchStubbed(res.stubbed);
    });
  }

  function reembedMissing() {
    setError(null);
    setReembedNotice(null);
    startReembed(async () => {
      const res = await reembedMissingArtifactsAction();
      if (!("ok" in res) || !res.ok) {
        setError("error" in res ? res.error : "Re-embed failed.");
        return;
      }
      setReembedNotice(
        `Re-embed complete — ${res.embedded} artifact${
          res.embedded === 1 ? "" : "s"
        } indexed${res.skipped > 0 ? `, ${res.skipped} skipped` : ""}.`,
      );
    });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.015] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Semantic search
          {initialStatus.stub ? (
            <span className="ml-2 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-200">
              stub mode — set OPENAI_API_KEY for real embeddings
            </span>
          ) : (
            <span className="ml-2 rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] text-emerald">
              live · {initialStatus.provider}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted">
          Indexed: {initialStatus.chunkCount.toLocaleString()} chunks across{" "}
          {initialStatus.artifactCount} artifact
          {initialStatus.artifactCount === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="aur-input flex-1 min-w-[280px]"
          placeholder="zero-trust on shipboard C5ISR · NAVSEA cyber · past performance with VA…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <button
          type="button"
          onClick={search}
          disabled={pending || query.trim().length < 3}
          className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
        >
          {pending ? "Searching…" : "Search"}
        </button>
        <button
          type="button"
          onClick={reembedMissing}
          disabled={reembedPending}
          className="aur-btn aur-btn-ghost text-[12px] disabled:opacity-60"
          title="Embed any indexed artifacts that don't yet have chunks. Safe to run repeatedly."
        >
          {reembedPending ? "Embedding…" : "Embed missing"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {reembedNotice ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {reembedNotice}
        </div>
      ) : null}

      {hits !== null ? (
        <div className="mt-4">
          {hits.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No matches. Try a broader query, or click <strong>Embed
              missing</strong> if you've added artifacts since the last index
              pass.
            </div>
          ) : (
            <>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                {hits.length} match{hits.length === 1 ? "" : "es"}
                {searchStubbed ? " · stub mode (results not semantic)" : ""}
              </div>
              <ul className="flex flex-col gap-2">
                {hits.map((h) => (
                  <SearchHitCard key={h.chunkId} hit={h} query={query} />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchHitCard({ hit, query }: { hit: SearchHit; query: string }) {
  const sim = Math.max(0, Math.min(1, hit.similarity));
  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/knowledge-base/import/${hit.artifactId}`}
            className="truncate font-display text-[13px] font-semibold text-text hover:underline"
          >
            {hit.artifactTitle || hit.artifactFileName || "Untitled artifact"}
          </Link>
          <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
            {hit.artifactKind.replace(/_/g, " ")}
          </span>
        </div>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
          style={{
            color: simColor(sim),
            backgroundColor: `${simColor(sim)}1A`,
            border: `1px solid ${simColor(sim)}40`,
          }}
          title={`Cosine similarity ${sim.toFixed(3)}`}
        >
          {Math.round(sim * 100)}%
        </span>
      </div>
      <div className="mt-2 max-h-40 overflow-hidden whitespace-pre-wrap font-body text-[12px] leading-relaxed text-muted">
        {highlight(hit.content, query)}
      </div>
      <div className="mt-2 font-mono text-[10px] text-muted">
        chunk #{hit.chunkIndex} · chars {hit.charStart}–{hit.charEnd}
      </div>
    </li>
  );
}

function simColor(s: number): string {
  if (s >= 0.85) return "#10B981"; // emerald
  if (s >= 0.7) return "#34D399"; // light emerald
  if (s >= 0.55) return "#2DD4BF"; // teal
  if (s >= 0.4) return "#A78BFA"; // violet
  return "#94A3B8"; // muted
}

function highlight(text: string, query: string): string {
  // We don't have semantic highlighting; just truncate around the
  // first keyword match to give the reader a focal point.
  if (!query) return text.slice(0, 800);
  const lowerText = text.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  let earliest = -1;
  for (const tok of tokens) {
    const idx = lowerText.indexOf(tok);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx;
  }
  if (earliest === -1) return text.slice(0, 800);
  const start = Math.max(0, earliest - 120);
  const end = Math.min(text.length, earliest + 600);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
