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
  accent?: "paper" | "hazard" | "blood" | "signal" | "ink" | "cobalt" | "plum" | "violet" | "emerald" | "gold" | "rose" | "magenta";
  icon?: ReactNode;
}) {
  // Figures are ink; only an error count keeps a hue.
  const accentColor = accent === "blood" || accent === "rose" ? "text-rose" : "text-text";

  return (
    <div className="border-t border-layer/10 pt-3">
      <div className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-label text-muted">
          {label}
        </span>
        {icon ? <span className="text-muted">{icon}</span> : null}
      </div>
      <div className={`mt-3 font-display text-3xl font-normal tabular-nums tracking-title ${accentColor}`}>
        {value}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
        {delta ? (
          <span className="flex items-center gap-1.5">
            <span
              className={`rounded-sm px-1 py-0.5 text-[10px] ${delta.up ? "bg-emerald/15 text-emerald" : "bg-rose/15 text-rose"}`}
            >
              {delta.up ? "▲" : "▼"}
            </span>
            {delta.value}
          </span>
        ) : (
          <span>{hint ?? ""}</span>
        )}
        <span>{hint && delta ? hint : ""}</span>
      </div>
    </div>
  );
}
