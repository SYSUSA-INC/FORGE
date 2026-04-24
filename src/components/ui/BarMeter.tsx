export function BarMeter({
  value,
  max = 100,
  color = "violet",
  label,
  right,
}: {
  value: number;
  max?: number;
  color?: "ink" | "hazard" | "blood" | "signal" | "cobalt" | "bone" | "violet" | "emerald" | "gold" | "rose" | "magenta";
  label?: string;
  right?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  const bar =
    color === "hazard" || color === "gold"
      ? "bg-gradient-to-r from-gold/80 to-gold"
      : color === "blood" || color === "rose"
        ? "bg-gradient-to-r from-rose/80 to-rose"
        : color === "signal" || color === "emerald"
          ? "bg-gradient-to-r from-emerald/80 to-emerald"
          : color === "magenta"
            ? "bg-gradient-to-r from-magenta/80 to-magenta"
            : color === "bone"
              ? "bg-white/15"
              : color === "ink"
                ? "bg-text"
                : "bg-gradient-to-r from-violet to-magenta";

  return (
    <div>
      {(label || right) && (
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted">
          <span>{label}</span>
          <span>{right ?? `${Math.round(pct)}%`}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
