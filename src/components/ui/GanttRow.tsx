export function GanttRow({
  startPct,
  endPct,
  label,
  color = "bg-ink",
  marker,
}: {
  startPct: number;
  endPct: number;
  label?: string;
  color?: string;
  marker?: number;
}) {
  return (
    <div className="relative h-6 w-full border-2 border-ink bg-bone">
      {/* grid */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-4 divide-x divide-ink/20">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div
        className={`absolute top-0 h-full border-r-2 border-ink ${color}`}
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
      />
      {marker !== undefined ? (
        <div
          className="absolute top-0 h-full w-[3px] bg-blood"
          style={{ left: `${marker}%` }}
          aria-label="now"
        />
      ) : null}
      {label ? (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold uppercase tracking-widest text-paper mix-blend-difference">
          {label}
        </div>
      ) : null}
    </div>
  );
}
