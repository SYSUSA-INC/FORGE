"use client";

import { useEffect, useRef, useState } from "react";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import { focusParagraph, shouldRefresh } from "@/lib/research-signals";
import { THEME } from "@/lib/theme-colors";
import { researchForSectionAction, type ResearchRailResult } from "./research-actions";

/**
 * BL-AIP-6 — research while you write.
 *
 * Watches the section text, and a couple of seconds after the writer
 * pauses looks up: Brain passages for the paragraph they are in,
 * mapped requirements the draft does not cover yet, win themes it does
 * not reinforce, and contradictions the last health scan raised. Each
 * passage can be dropped in as a tracked suggestion by FORGE AI.
 */
const DEBOUNCE_MS = 2_500;

export function ResearchRail({
  sectionId,
  text,
  onInsertTracked,
}: {
  sectionId: string;
  /** The section as plain text, updated on every keystroke. */
  text: string;
  /** Append a passage as a tracked insertion by FORGE AI. */
  onInsertTracked: (text: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<ResearchRailResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [focus, setFocus] = useState("");
  const lastLookupRef = useRef<string>("");
  const prevTextRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(0);

  async function lookup(currentText: string, currentFocus: string) {
    const id = ++inflightRef.current;
    setPending(true);
    setError(null);
    try {
      const res = await researchForSectionAction(sectionId, { text: currentText, focus: currentFocus });
      if (id !== inflightRef.current) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setData(res.data);
      lastLookupRef.current = currentText;
    } catch (err) {
      if (id !== inflightRef.current) return;
      setError(err instanceof Error ? err.message : "Research lookup failed.");
    } finally {
      if (id === inflightRef.current) setPending(false);
    }
  }

  // Debounced refresh as the text moves.
  useEffect(() => {
    if (!open) return;
    const prev = prevTextRef.current;
    prevTextRef.current = text;
    const nextFocus = focusParagraph(prev, text);
    if (nextFocus) setFocus(nextFocus);
    if (!shouldRefresh(lastLookupRef.current, text)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void lookup(text, nextFocus || focus);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `focus` is read for the fallback only; the paragraph is recomputed each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open, sectionId]);

  const counts = data
    ? data.hits.length + data.unaddressed.length + data.missingThemes.length + data.contradictions.length
    : 0;

  return (
    <div className="rounded-lg border border-indigo-400/20 bg-indigo-400/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-indigo-300">
          ⌕ Research while you write
          {data ? ` · ${counts}` : ""}
          {pending ? " · looking…" : ""}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] text-muted">
          {open ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                void lookup(text, focus || focusParagraph("", text));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  void lookup(text, focus || focusParagraph("", text));
                }
              }}
              className="rounded border border-layer/10 px-1.5 py-0.5 hover:text-text"
              title="Look up now"
            >
              refresh
            </span>
          ) : null}
          <span>{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-indigo-400/15 p-3">
          {error ? (
            <div className="rounded border border-rose/40 bg-rose/10 px-2 py-1 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}
          {!data && !pending ? (
            <p className="font-mono text-[11px] text-muted">
              Keep writing. A couple of seconds after you pause, the rail shows Brain
              passages for the paragraph you are in, requirements this section has
              not covered yet, win themes it has not reinforced, and any contradiction
              the last health scan raised.
            </p>
          ) : null}

          {data && data.unaddressed.length > 0 ? (
            <Group title="Requirements not covered yet" tone={THEME.brass}>
              {data.unaddressed.map((r) => (
                <li key={r.id} className="font-body text-[11px] leading-relaxed text-text">
                  <span className="font-mono text-[10px] text-muted">[{r.number || "?"}]</span> {r.text}
                  <span className="ml-1 font-mono text-[9px] text-muted">
                    · missing: {r.missingTerms.join(", ")}
                  </span>
                </li>
              ))}
            </Group>
          ) : null}

          {data && data.missingThemes.length > 0 ? (
            <Group title="Win themes not reinforced" tone={THEME.plum}>
              {data.missingThemes.map((t) => (
                <li key={t.title} className="font-body text-[11px] leading-relaxed text-text">
                  <span className="font-semibold">{t.title}</span>
                  {t.statement ? <span className="text-muted"> — {t.statement}</span> : null}
                </li>
              ))}
            </Group>
          ) : null}

          {data && data.contradictions.length > 0 ? (
            <Group title="Contradictions from the last scan" tone={THEME.red}>
              {data.contradictions.map((c, i) => (
                <li key={i} className="font-body text-[11px] leading-relaxed text-text">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
                    {c.severity} · vs {c.otherSectionTitle}
                  </span>
                  <div>
                    <span className="text-rose">“{c.claim1}”</span> vs{" "}
                    <span className="text-rose">“{c.claim2}”</span>
                  </div>
                  <div className="text-muted">{c.explanation}</div>
                </li>
              ))}
            </Group>
          ) : null}

          {data ? (
            <Group
              title={`Brain passages${focus ? " for this paragraph" : ""}`}
              tone={THEME.indigo}
              trailing={data.stubbed ? <StubModeBanner variant="inline" /> : null}
            >
              {data.hits.length === 0 ? (
                <li className="font-mono text-[11px] text-muted">
                  {data.brainNote ?? "Nothing close enough in the Brain for this paragraph."}
                </li>
              ) : (
                data.hits.map((h) => (
                  <li key={h.id} className="rounded border border-layer/10 bg-layer/[0.02] p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate font-display text-[12px] font-semibold text-text">
                        {h.title}
                        {h.outcomeLabel && h.outcomeLabel !== "none" ? (
                          <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-muted">
                            {h.outcomeLabel}
                          </span>
                        ) : null}
                        <span className="ml-1 font-mono text-[9px] text-muted">
                          {Math.round(Math.max(0, Math.min(1, h.similarity)) * 100)}%
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onInsertTracked(h.content.trim())}
                        className="aur-btn aur-btn-ghost text-[10px]"
                        title="Append this passage as a tracked suggestion by FORGE AI"
                      >
                        Insert as suggestion
                      </button>
                    </div>
                    <div className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap font-body text-[11px] leading-relaxed text-muted">
                      {h.content}
                    </div>
                  </li>
                ))
              )}
            </Group>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Group({
  title,
  tone,
  trailing,
  children,
}: {
  title: string;
  tone: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: tone }}>
        <span>{title}</span>
        {trailing}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}
