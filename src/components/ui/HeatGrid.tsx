export function HeatGrid({
  matrix,
  rows,
  cols,
  legend,
  title,
}: {
  matrix: number[][];
  rows: string[];
  cols: string[];
  legend?: string;
  title?: string;
}) {
  const max = Math.max(1, ...matrix.flat());

  const cellStyle = (v: number) => {
    const r = v / max;
    if (v === 0) return "bg-white/[0.03] text-subtle";
    if (r < 0.25) return "bg-violet/15 text-text";
    if (r < 0.5) return "bg-violet/30 text-white";
    if (r < 0.75) return "bg-gradient-to-br from-violet/50 to-magenta/40 text-white";
    return "bg-gradient-to-br from-magenta/70 to-gold/50 text-white";
  };

  return (
    <div className="font-mono text-[10px]">
      {(title || legend) && (
        <div className="mb-2 flex items-center justify-between uppercase tracking-[0.2em] text-muted">
          <span>{title}</span>
          {legend ? <span>{legend}</span> : null}
        </div>
      )}
      <div
        className="grid gap-1 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] p-1"
        style={{
          gridTemplateColumns: `72px repeat(${cols.length}, minmax(0, 1fr))`,
        }}
      >
        <div />
        {cols.map((c) => (
          <div
            key={c}
            className="px-1 py-1 text-center text-[9px] font-semibold uppercase tracking-widest text-muted"
          >
            {c}
          </div>
        ))}
        {rows.map((r, ri) => (
          <div key={r} className="contents">
            <div className="px-2 py-1.5 text-right text-[9px] font-semibold uppercase tracking-widest text-muted">
              {r}
            </div>
            {cols.map((c, ci) => (
              <div
                key={`${r}-${c}`}
                className={`grid h-8 place-items-center rounded-md ${cellStyle(
                  matrix[ri][ci] ?? 0,
                )}`}
                title={`${r} / ${c} = ${matrix[ri][ci] ?? 0}`}
              >
                <span className="font-mono text-[10px] font-bold tabular-nums">
                  {matrix[ri][ci] ?? 0}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted">
        <span>Low</span>
        <span className="h-2 w-4 rounded bg-violet/15" />
        <span className="h-2 w-4 rounded bg-violet/30" />
        <span className="h-2 w-4 rounded bg-gradient-to-r from-violet/50 to-magenta/40" />
        <span className="h-2 w-4 rounded bg-gradient-to-r from-magenta/70 to-gold/50" />
        <span>High</span>
      </div>
    </div>
  );
}
