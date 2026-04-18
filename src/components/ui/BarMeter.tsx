export function BarMeter({
  value,
  max = 100,
  color = "ink",
  label,
  right,
}: {
  value: number;
  max?: number;
  color?: "ink" | "hazard" | "blood" | "signal" | "cobalt" | "bone";
  label?: string;
  right?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bg =
    color === "hazard"
      ? "bg-hazard"
      : color === "blood"
        ? "bg-blood"
        : color === "signal"
          ? "bg-signal"
          : color === "cobalt"
            ? "bg-cobalt"
            : color === "bone"
              ? "bg-bone"
              : "bg-ink";
  return (
    <div>
      {(label || right) && (
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
          <span>{label}</span>
          <span className="text-ink/70">{right ?? `${Math.round(pct)}%`}</span>
        </div>
      )}
      <div className="h-3 w-full border-2 border-ink bg-paper">
        <div className={`h-full ${bg}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
