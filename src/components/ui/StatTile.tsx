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
  const glow =
    accent === "hazard" || accent === "gold"
      ? "shadow-glow-gold"
      : accent === "signal" || accent === "emerald"
        ? "shadow-glow-emerald"
        : accent === "cobalt" || accent === "violet" || accent === "plum" || accent === "magenta"
          ? "shadow-glow"
          : "";

  const accentColor =
    accent === "hazard" || accent === "gold"
      ? "text-gold"
      : accent === "blood" || accent === "rose"
        ? "text-rose"
        : accent === "signal" || accent === "emerald"
          ? "text-emerald"
          : accent === "cobalt" || accent === "violet"
            ? "text-violet"
            : accent === "plum" || accent === "magenta"
              ? "text-magenta"
              : "text-text";

  return (
    <div className={`aur-card p-4 ${glow}`}>
      <div className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {label}
        </span>
        {icon ? <span className="text-muted">{icon}</span> : null}
      </div>
      <div className={`mt-3 font-display text-3xl font-semibold tabular-nums tracking-tight ${accentColor}`}>
        {value}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
        {delta ? (
          <span className="flex items-center gap-1.5">
            <span
              className={`rounded-sm px-1 py-0.5 text-[9px] ${delta.up ? "bg-emerald/15 text-emerald" : "bg-rose/15 text-rose"}`}
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
