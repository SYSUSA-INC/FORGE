"use client";

import { useRouter, useSearchParams } from "next/navigation";

type WindowKey = "30" | "90" | "365" | "all";
type ModeKey = "count" | "value";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "30", label: "Last 30d" },
  { key: "90", label: "Last 90d" },
  { key: "365", label: "Last 365d" },
  { key: "all", label: "All time" },
];

const MODES: { key: ModeKey; label: string; help: string }[] = [
  {
    key: "count",
    label: "Count",
    help: "Bar width = number of opportunities in stage",
  },
  {
    key: "value",
    label: "Weighted value",
    help: "Bar width = sum of PWin% × midpoint of value range",
  },
];

/**
 * Toggle controls for the pipeline funnel — time-window pills + a
 * count/value mode tab. State lives on the URL (`?days=…&mode=…`)
 * so the view is shareable, reloadable, and back-button friendly.
 *
 * The page.tsx server component reads the same params to fetch and
 * compute the funnel — this client component only owns the controls,
 * not the rendering.
 */
export function PipelineFilters({
  currentWindow,
  currentMode,
}: {
  currentWindow: WindowKey;
  currentMode: ModeKey;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set(key, value);
    router.push(`/pipeline?${next.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {WINDOWS.map((w) => {
          const active = currentWindow === w.key;
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => setParam("days", w.key)}
              className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "border-teal-400 bg-teal-400/10 text-text"
                  : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
              }`}
            >
              {w.label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] p-1">
        {MODES.map((m) => {
          const active = currentMode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setParam("mode", m.key)}
              title={m.help}
              className={`rounded px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "bg-white/10 text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
