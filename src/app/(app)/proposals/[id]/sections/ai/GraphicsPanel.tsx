"use client";

import { useState, useTransition } from "react";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import { GRAPHIC_KIND_LABELS } from "@/lib/graphics-logic";
import { suggestSectionGraphicsAction, type GraphicSuggestion } from "./graphics-actions";

/**
 * BL-FB-GEN-GRAPHICS — diagrams this section would benefit from, drawn
 * from its own text: a preview per suggestion, inserted inline as an
 * image, or taken as Mermaid / SVG for other tools.
 */
export function GraphicsPanel({
  sectionId,
  getCurrentText,
  onInsertImage,
}: {
  sectionId: string;
  getCurrentText: () => string;
  /** Add an image node (data URI, alt text) at the end of the section. */
  onInsertImage: (src: string, alt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<GraphicSuggestion[] | null>(null);
  const [meta, setMeta] = useState<{ stubbed: boolean; fallback: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function suggest() {
    setError(null);
    setOpen(true);
    startTransition(async () => {
      const res = await suggestSectionGraphicsAction({ sectionId, currentBodyPlain: getCurrentText() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuggestions(res.suggestions);
      setMeta({ stubbed: res.stubbed, fallback: res.fallback });
    });
  }

  async function copyMermaid(s: GraphicSuggestion) {
    try {
      await navigator.clipboard.writeText(s.mermaid);
      setCopied(s.title);
      setTimeout(() => setCopied(null), 2_000);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  function downloadSvg(s: GraphicSuggestion) {
    const url = URL.createObjectURL(new Blob([s.svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${s.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "diagram"}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <div className="rounded-lg border border-plum-400/20 bg-plum-400/5">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-plum-300">
            ▦ Graphics
            {suggestions ? ` · ${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}` : ""}
          </span>
        </button>
        <button
          type="button"
          onClick={suggest}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
          title="Read the section and propose the diagrams it would benefit from"
        >
          {pending ? "Reading…" : suggestions ? "Suggest again" : "Suggest graphics"}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-layer/10 px-3 py-2">
          {error ? (
            <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div>
          ) : null}
          {meta?.stubbed ? <StubModeBanner variant="inline" /> : null}
          {meta?.fallback && !meta.stubbed ? (
            <p className="font-body text-[11px] text-muted">The model proposed nothing usable, so these are read from the section's own words.</p>
          ) : null}
          {suggestions && suggestions.length === 0 ? (
            <p className="font-body text-[12px] text-muted">
              No diagram stands out yet. Steps in order, named components, roles or dated milestones give the suggestions something to draw.
            </p>
          ) : null}
          {!suggestions && !pending && !error ? (
            <p className="font-body text-[12px] text-muted">
              Click <strong>Suggest graphics</strong>: the section is read for steps, components, roles and milestones, and each diagram arrives as a starter SVG you can insert, plus a Mermaid block.
            </p>
          ) : null}
          {(suggestions ?? []).map((s) => (
            <div key={`${s.kind}-${s.title}`} className="rounded-md border border-layer/10 bg-layer/[0.02] p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded border border-plum-400/40 bg-plum-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-plum-300">
                  {GRAPHIC_KIND_LABELS[s.kind]}
                </span>
                <span className="font-display text-[13px] font-semibold text-text">{s.title}</span>
              </div>
              <p className="mb-2 font-body text-[11px] leading-relaxed text-muted">{s.why}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data-URI SVG, not an optimisable asset */}
              <img src={s.dataUri} alt={s.title} className="w-full rounded border border-layer/10 bg-white" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onInsertImage(s.dataUri, s.title)}
                  className="aur-btn aur-btn-primary text-[11px]"
                  title="Add the diagram at the end of the section as an image; drag it where it belongs"
                >
                  Insert into section
                </button>
                <button type="button" onClick={() => void copyMermaid(s)} className="aur-btn aur-btn-ghost text-[11px]">
                  {copied === s.title ? "Copied" : "Copy Mermaid"}
                </button>
                <button type="button" onClick={() => downloadSvg(s)} className="aur-btn aur-btn-ghost text-[11px]">
                  Download SVG
                </button>
                <span className="font-mono text-[9px] uppercase tracking-wider text-subtle">
                  {s.nodes.length} nodes · {s.edges.length} links
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
