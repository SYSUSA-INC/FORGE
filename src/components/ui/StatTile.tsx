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
  accent?: "paper" | "hazard" | "blood" | "signal" | "ink" | "cobalt";
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
              : "bg-paper text-ink";

  return (
    <div className={`relative border-2 border-ink shadow-brut ${tone}`}>
      <div className="flex items-start justify-between border-b-2 border-current/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em]">
        <span>{label}</span>
        <span className="opacity-60">◼</span>
      </div>
      <div className="flex items-end justify-between gap-3 px-3 pb-3 pt-2">
        <div className="font-display text-5xl font-bold leading-none tracking-tight">
          {value}
        </div>
        {icon ? <div className="opacity-70">{icon}</div> : null}
      </div>
      <div className="flex items-center justify-between border-t-2 border-current/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider">
        {delta ? (
          <span className="flex items-center gap-1">
            <span>{delta.up ? "▲" : "▼"}</span>
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
