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

  const color = (v: number) => {
    if (v === 0) return "bg-paper";
    const r = v / max;
    if (r < 0.2) return "bg-bone";
    if (r < 0.4) return "bg-[#F3E29B]";
    if (r < 0.6) return "bg-hazard";
    if (r < 0.8) return "bg-[#F79523]";
    return "bg-blood";
  };

  return (
    <div className="font-mono text-[10px]">
      {title ? (
        <div className="mb-1 flex items-center justify-between uppercase tracking-[0.25em] text-ink/70">
          <span>{title}</span>
          {legend ? <span>{legend}</span> : null}
        </div>
      ) : null}
      <div className="grid gap-0 border-2 border-ink" style={{ gridTemplateColumns: `64px repeat(${cols.length}, minmax(0, 1fr))` }}>
        <div className="border-b-2 border-ink bg-ink" />
        {cols.map((c) => (
          <div
            key={c}
            className="border-b-2 border-l border-ink bg-ink px-1 py-1 text-center text-[9px] font-bold uppercase tracking-widest text-paper"
          >
            {c}
          </div>
        ))}
        {rows.map((r, ri) => (
          <div key={r} className="contents">
            <div className="border-t border-ink bg-ink px-2 py-1 text-right text-[9px] font-bold uppercase tracking-widest text-paper">
              {r}
            </div>
            {cols.map((c, ci) => (
              <div
                key={`${r}-${c}`}
                className={`relative grid h-7 place-items-center border-t border-l border-ink ${color(
                  matrix[ri][ci] ?? 0,
                )}`}
                title={`${r} / ${c} = ${matrix[ri][ci] ?? 0}`}
              >
                <span className="font-mono text-[10px] font-bold text-ink/80">
                  {matrix[ri][ci] ?? 0}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[9px] uppercase tracking-widest text-ink/60">
        <span>LOW</span>
        <span className="h-2 w-4 border border-ink bg-bone" />
        <span className="h-2 w-4 border border-ink bg-[#F3E29B]" />
        <span className="h-2 w-4 border border-ink bg-hazard" />
        <span className="h-2 w-4 border border-ink bg-[#F79523]" />
        <span className="h-2 w-4 border border-ink bg-blood" />
        <span>HIGH</span>
      </div>
    </div>
  );
}
