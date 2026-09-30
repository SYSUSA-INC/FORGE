"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askBrainAction, paletteSearchAction } from "@/app/(app)/palette/actions";
import type { NavVisibility } from "@/lib/nav-visibility";
import {
  canSearch,
  PALETTE_KIND_LABELS,
  PALETTE_OPEN_EVENT,
  paletteCommands,
  paletteRows,
  rankCommands,
  type BrainAnswerView,
  type PaletteRecord,
  type PaletteRow,
} from "@/lib/palette";

/**
 * BL-AIP-7d — the ⌘K command palette.
 *
 * Opens on ⌘K / Ctrl+K anywhere in the app, or from the header box.
 * One text field: pages the sidebar lists rank as you type, the
 * workspace's records come back from the server (debounced), and any
 * text long enough can be sent to the Brain, which answers from the
 * org's own knowledge with the sources it cited as links. Arrow keys
 * move, Enter opens or asks, Esc closes.
 */
export function CommandPalette({ isOrgAdmin, isSuperadmin, hasWorkspace }: NavVisibility) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<PaletteRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<BrainAnswerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const latestQuery = useRef("");

  const commands = useMemo(
    () => paletteCommands({ isOrgAdmin, isSuperadmin, hasWorkspace }),
    [isOrgAdmin, isSuperadmin, hasWorkspace],
  );
  const ranked = useMemo(() => rankCommands(commands, query, query.trim() ? 8 : 6), [commands, query]);
  const rows = useMemo<PaletteRow[]>(
    () => paletteRows({ query, records: canSearch(query) ? records : [], commands: ranked }),
    [query, records, ranked],
  );

  const reset = useCallback(() => {
    setQuery("");
    setRecords([]);
    setActive(0);
    setAnswer(null);
    setError(null);
    setAsking(false);
    setSearching(false);
    latestQuery.current = "";
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  // ⌘K / Ctrl+K toggles; the header box dispatches PALETTE_OPEN_EVENT.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => {
          if (o) reset();
          return !o;
        });
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_OPEN_EVENT, onOpen);
    };
  }, [reset]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Debounced record search; a stale reply never overwrites a newer one.
  useEffect(() => {
    if (!open || answer) return undefined;
    const q = query.trim();
    latestQuery.current = q;
    if (!canSearch(q)) {
      setRecords([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const t = window.setTimeout(() => {
      paletteSearchAction(q)
        .then((res) => {
          if (latestQuery.current !== q) return;
          setRecords(res.ok ? res.results : []);
          if (!res.ok) setError(res.error);
        })
        .catch(() => {
          if (latestQuery.current === q) setRecords([]);
        })
        .finally(() => {
          if (latestQuery.current === q) setSearching(false);
        });
    }, 220);
    return () => window.clearTimeout(t);
  }, [open, query, answer]);

  useEffect(() => {
    setActive(0);
  }, [query, records.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const ask = useCallback(async (question: string) => {
    setAsking(true);
    setError(null);
    try {
      const res = await askBrainAction(question);
      if (res.ok) setAnswer(res.view);
      else setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The Brain could not answer.");
    } finally {
      setAsking(false);
    }
  }, []);

  const activate = useCallback(
    (row: PaletteRow) => {
      if (row.type === "ask") {
        void ask(row.question);
        return;
      }
      const href = row.type === "record" ? row.record.href : row.command.href;
      close();
      router.push(href);
    },
    [ask, close, router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (answer) {
        setAnswer(null);
        return;
      }
      close();
      return;
    }
    if (answer || asking) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) activate(row);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]">
      <div onClick={close} aria-hidden className="absolute inset-0 bg-canvas/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-layer/15 bg-canvas/95 shadow-card-lg backdrop-blur-xl"
      >
        <label className="relative flex items-center border-b border-layer/10">
          <span className="pointer-events-none absolute left-4 text-muted">{asking ? "…" : "⌕"}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (answer) setAnswer(null);
            }}
            onKeyDown={onKeyDown}
            placeholder="Go to a page, find a record, or ask the Brain…"
            aria-label="Search or ask"
            autoComplete="off"
            spellCheck={false}
            disabled={asking}
            className="w-full bg-transparent py-3.5 pl-11 pr-16 font-body text-sm text-text placeholder:text-subtle outline-none"
          />
          <kbd className="absolute right-3 rounded-md border border-layer/10 bg-layer/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            esc
          </kbd>
        </label>

        {error ? (
          <p className="border-b border-layer/10 px-4 py-2 font-mono text-[11px] text-rose-300">{error}</p>
        ) : null}

        {answer ? (
          <AnswerPanel view={answer} onBack={() => setAnswer(null)} onClose={close} />
        ) : (
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center font-mono text-[11px] text-muted">
                {searching ? "Searching…" : "Nothing matches. Keep typing, or ask a question."}
              </p>
            ) : (
              <RowList rows={rows} active={active} onHover={setActive} onPick={activate} asking={asking} />
            )}
            {searching && rows.length > 0 ? (
              <p className="px-4 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Searching…</p>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-layer/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
          <span>↑↓ move</span>
          <span>↵ open · ask</span>
          <span>esc close</span>
          <span className="ml-auto normal-case tracking-normal">Answers come from your own Brain and cite their sources.</span>
        </div>
      </div>
    </div>
  );
}

function RowList({
  rows,
  active,
  onHover,
  onPick,
  asking,
}: {
  rows: PaletteRow[];
  active: number;
  onHover: (i: number) => void;
  onPick: (row: PaletteRow) => void;
  asking: boolean;
}) {
  let lastSection: string | null = null;
  return (
    <ul role="listbox" aria-label="Results">
      {rows.map((row, i) => {
        const section = row.type === "ask" ? "Ask the Brain" : row.type === "record" ? "In your workspace" : "Go to";
        const header = section !== lastSection ? section : null;
        lastSection = section;
        const isActive = i === active;
        return (
          <li key={row.type === "ask" ? "ask" : row.type === "record" ? `r-${row.record.id}` : `c-${row.command.id}`}>
            {header ? (
              <p className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">{header}</p>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              data-index={i}
              disabled={asking}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(row)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                isActive ? "bg-layer/10" : "hover:bg-layer/5"
              }`}
            >
              {row.type === "ask" ? (
                <>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-violet/40 bg-violet/10 font-mono text-xs text-text">
                    ✦
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-sm text-text">
                      {asking ? "Asking the Brain…" : `Ask the Brain: “${row.question}”`}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-muted">
                      Answered from your knowledge entries and imported documents, with sources
                    </span>
                  </span>
                </>
              ) : row.type === "record" ? (
                <>
                  <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                    {PALETTE_KIND_LABELS[row.record.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-sm text-text">{row.record.title}</span>
                    {row.record.subtitle ? (
                      <span className="block truncate font-mono text-[10px] text-muted">{row.record.subtitle}</span>
                    ) : null}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-24 shrink-0 truncate font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                    {row.command.group}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-body text-sm text-text">{row.command.label}</span>
                  <span className="hidden shrink-0 font-mono text-[10px] text-subtle sm:inline">{row.command.href}</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AnswerPanel({ view, onBack, onClose }: { view: BrainAnswerView; onBack: () => void; onClose: () => void }) {
  const cited = view.sources.filter((s) => s.cited);
  const others = view.sources.filter((s) => !s.cited);
  const confidencePct = Math.round(view.confidence * 100);
  return (
    <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
        <span className="rounded-md border border-violet/40 bg-violet/10 px-2 py-0.5 text-text">Brain answer</span>
        {view.extractive ? (
          <span className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-200">
            {view.stubbed ? "AI in stub mode · quoted source" : "Quoted source"}
          </span>
        ) : (
          <span>Confidence {confidencePct}%</span>
        )}
        {view.model ? <span className="normal-case tracking-normal">{view.model}</span> : null}
      </div>
      <p className="mb-1 font-mono text-[11px] text-muted">“{view.question}”</p>
      <p className="whitespace-pre-wrap font-body text-sm leading-relaxed text-text">{view.answer}</p>

      {cited.length > 0 ? (
        <SourceList title="Sources cited" sources={cited} onClose={onClose} />
      ) : null}
      {others.length > 0 ? (
        <SourceList title={cited.length ? "Also found" : "Found in the Brain"} sources={others} onClose={onClose} />
      ) : null}

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={onBack} className="aur-btn-ghost px-0">
          ← Ask another
        </button>
        <Link href="/knowledge-base" onClick={onClose} className="aur-btn-ghost px-0">
          Open Knowledge
        </Link>
      </div>
    </div>
  );
}

function SourceList({
  title,
  sources,
  onClose,
}: {
  title: string;
  sources: BrainAnswerView["sources"];
  onClose: () => void;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">{title}</p>
      <ul className="space-y-1">
        {sources.map((s) => (
          <li key={s.n}>
            <Link
              href={s.href}
              onClick={onClose}
              className="block rounded-md border border-layer/10 bg-layer/[0.03] px-3 py-2 transition-colors hover:border-layer/20 hover:bg-layer/5"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted">[{s.n}]</span>
                <span className="truncate font-body text-sm text-text">{s.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-subtle">
                  {s.source === "entry" ? s.kind.replace(/_/g, " ") : "document"}
                  {s.outcomeLabel === "won" ? " · won" : s.outcomeLabel === "lost" ? " · lost" : ""}
                </span>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted">{s.preview}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
