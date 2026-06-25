"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  applyComplianceAutoMapAction,
  runComplianceAutoMapAction,
  type AutoMapSuggestion,
} from "./actions";

type SectionLite = { id: string; title: string; ordering: number };

const CONFIDENCE_STYLE: Record<
  "high" | "medium" | "low",
  { color: string; label: string }
> = {
  high: { color: "#34d399", label: "HIGH" },
  medium: { color: "#fbbf24", label: "MED" },
  low: { color: "#94a3b8", label: "LOW" },
};

export function AutoMapPanel({
  proposalId,
  unmappedCount,
  sections,
}: {
  proposalId: string;
  unmappedCount: number;
  sections: SectionLite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [applyPending, startApplyTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<AutoMapSuggestion[]>([]);
  const [unchanged, setUnchanged] = useState(0);
  // Per-row chosen sectionId (defaults to AI suggestion; user can override).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  function runAutoMap() {
    setError(null);
    setNotice(null);
    setSuggestions([]);
    setOverrides({});
    setExcluded({});
    startTransition(async () => {
      const res = await runComplianceAutoMapAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuggestions(res.suggestions);
      setUnchanged(res.unchanged);
      if (res.suggestions.length === 0) {
        setNotice(
          res.unchanged > 0
            ? `AI confirmed all ${res.unchanged} existing mappings. No changes needed.`
            : `AI returned no actionable suggestions.${res.stubbed ? " (stub mode — set ANTHROPIC_API_KEY for live)" : ""}`,
        );
      } else {
        setNotice(
          `AI suggests ${res.suggestions.length} mapping${res.suggestions.length === 1 ? "" : "s"}${res.unchanged > 0 ? ` (${res.unchanged} unchanged)` : ""}.${res.stubbed ? " (stub mode)" : ""}`,
        );
      }
    });
  }

  function chosenSectionFor(s: AutoMapSuggestion): string {
    return overrides[s.itemId] ?? s.suggestedSectionId;
  }

  function applySelected(filter: (s: AutoMapSuggestion) => boolean) {
    const picked = suggestions
      .filter((s) => !excluded[s.itemId])
      .filter(filter)
      .map((s) => ({ itemId: s.itemId, sectionId: chosenSectionFor(s) }))
      .filter((m) => m.sectionId);
    if (picked.length === 0) {
      setError("Nothing selected to apply.");
      return;
    }
    setError(null);
    setNotice(null);
    startApplyTransition(async () => {
      const res = await applyComplianceAutoMapAction(proposalId, picked);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Applied ${res.applied} mapping${res.applied === 1 ? "" : "s"}.`,
      );
      // Remove applied items from the working set.
      const appliedIds = new Set(picked.map((p) => p.itemId));
      setSuggestions((prev) => prev.filter((s) => !appliedIds.has(s.itemId)));
      router.refresh();
    });
  }

  const highCount = suggestions.filter(
    (s) => s.confidence === "high" && !excluded[s.itemId],
  ).length;
  const selectableCount = suggestions.filter((s) => !excluded[s.itemId]).length;

  return (
    <Panel
      title="Auto-map requirements (BL-FB-CM-AUTOMAP)"
      eyebrow={
        suggestions.length > 0
          ? `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} pending review`
          : "AI assigns each requirement to the best-fit section"
      }
      actions={
        <button
          type="button"
          onClick={runAutoMap}
          disabled={pending || applyPending}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          title={
            unmappedCount === 0
              ? "All items are already mapped. Re-run to suggest changes."
              : "Use the AI to map every item to a section."
          }
        >
          {pending
            ? "Mapping…"
            : suggestions.length > 0
              ? "Re-run mapping"
              : `Auto-map ${unmappedCount > 0 ? `${unmappedCount} unmapped` : "all"}`}
        </button>
      }
    >
      <p className="font-body text-[13px] leading-relaxed text-muted">
        Asks the AI to pick the best-fit proposal section for every compliance
        item using requirement text + section titles. You review the
        suggestions per row, override the chosen section if needed, then apply
        in bulk. Items already mapped to the AI&apos;s choice are skipped.
      </p>

      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applySelected((s) => s.confidence === "high")}
              disabled={applyPending || highCount === 0}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              title="Apply only the suggestions the AI is confident about."
            >
              {applyPending
                ? "Applying…"
                : `Apply ${highCount} high-confidence`}
            </button>
            <button
              type="button"
              onClick={() => applySelected(() => true)}
              disabled={applyPending || selectableCount === 0}
              className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
              title="Apply every selected suggestion regardless of confidence."
            >
              Apply all selected ({selectableCount})
            </button>
            {unchanged > 0 ? (
              <span className="font-mono text-[10px] text-muted">
                {unchanged} unchanged (AI confirmed existing)
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex max-h-[500px] flex-col gap-2 overflow-y-auto">
            {suggestions.map((s) => {
              const isExcluded = !!excluded[s.itemId];
              const conf = CONFIDENCE_STYLE[s.confidence];
              const chosenId = chosenSectionFor(s);
              return (
                <div
                  key={s.itemId}
                  className={`rounded-md border bg-white/[0.02] p-3 transition-opacity ${
                    isExcluded
                      ? "border-white/5 opacity-50"
                      : "border-white/10"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      onChange={(e) =>
                        setExcluded((prev) => ({
                          ...prev,
                          [s.itemId]: !e.target.checked,
                        }))
                      }
                      className="mt-1 accent-teal-400"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-text">
                          {s.itemNumber || "(no #)"}
                        </span>
                        <span
                          className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
                          style={{
                            color: conf.color,
                            background: `${conf.color}1a`,
                            border: `1px solid ${conf.color}40`,
                          }}
                        >
                          {conf.label}
                        </span>
                        {s.currentSectionId ? (
                          <span className="font-mono text-[10px] text-amber-300">
                            re-map
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-emerald">
                            new
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate font-body text-[12px] text-foreground">
                        {s.itemText}
                      </div>
                      <div className="mt-1 font-mono text-[10px] italic leading-relaxed text-muted">
                        {s.rationale}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                          Assign to:
                        </span>
                        <select
                          value={chosenId}
                          onChange={(e) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [s.itemId]: e.target.value,
                            }))
                          }
                          disabled={isExcluded}
                          className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-text"
                        >
                          {sections.map((sec) => (
                            <option key={sec.id} value={sec.id}>
                              {sec.ordering}. {sec.title}
                            </option>
                          ))}
                        </select>
                        {chosenId !== s.suggestedSectionId ? (
                          <span className="font-mono text-[9px] uppercase tracking-wider text-amber-300">
                            overridden
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </Panel>
  );
}
