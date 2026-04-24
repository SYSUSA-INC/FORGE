export function GanttRow({
  startPct,
  endPct,
  label,
  color = "bg-gradient-to-r from-violet to-magenta",
  marker,
}: {
  startPct: number;
  endPct: number;
  label?: string;
  color?: string;
  marker?: number;
}) {
  return (
    <div className="relative h-6 w-full overflow-hidden rounded-md border border-white/10 bg-white/[0.03]">
      <div className="pointer-events-none absolute inset-0 grid grid-cols-4 divide-x divide-white/5">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div
        className={`absolute top-0 h-full rounded-md ${color}`}
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
      />
      {marker !== undefined ? (
        <div
          className="absolute top-0 h-full w-[2px] bg-gold"
          style={{ left: `${marker}%` }}
          aria-label="now"
        />
      ) : null}
      {label ? (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] font-semibold tracking-widest text-white mix-blend-difference">
          {label}
        </div>
      ) : null}
    </div>
  );
}
