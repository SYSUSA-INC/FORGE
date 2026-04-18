import { ReactNode } from "react";

export function StatTile({
  label,
  value,
  delta,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: string;
  delta?: { value: string; up?: boolean };
  hint?: string;
  accent?: "paper" | "hazard" | "blood" | "signal" | "ink" | "cobalt" | "plum";
  icon?: ReactNode;
}) {
  const tone =
    accent === "hazard"
      ? "bg-hazard text-ink"
      : accent === "blood"
        ? "bg-blood text-paper"
        : accent === "signal"
          ? "bg-signal text-ink"
          : accent === "ink"
            ? "bg-ink text-paper"
            : accent === "cobalt"
              ? "bg-cobalt text-paper"
              : accent === "plum"
                ? "bg-plum text-paper"
                : "bg-paper text-ink";

  return (
    <div className={`relative overflow-hidden border-2 border-ink shadow-brut ${tone}`}>
      {/* Corner hazard marker */}
      <div className="pointer-events-none absolute right-0 top-0 h-4 w-4 brut-diagonal opacity-40" />
      <div className="flex items-start justify-between border-b-2 border-current/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em]">
        <span>{label}</span>
        <span className="opacity-60">◼</span>
      </div>
      <div className="flex items-end justify-between gap-3 px-3 pb-2 pt-2">
        <div className="brut-stencil text-[52px] leading-none tracking-[-0.04em]">
          {value}
        </div>
        {icon ? <div className="opacity-70">{icon}</div> : null}
      </div>
      <div className="flex items-center justify-between border-t-2 border-current/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider">
        {delta ? (
          <span className="flex items-center gap-1">
            <span className={`px-1 ${delta.up ? "bg-signal text-ink" : "bg-blood text-paper"}`}>
              {delta.up ? "▲" : "▼"}
            </span>
            {delta.value}
          </span>
        ) : (
          <span className="opacity-70">{hint ?? "—"}</span>
        )}
        <span className="opacity-60">{hint && delta ? hint : ""}</span>
      </div>
    </div>
  );
}
