export type PieSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

export function PieChart({
  slices,
  size = 240,
  innerRatio = 0.55,
}: {
  slices: PieSlice[];
  size?: number;
  innerRatio?: number;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const ir = r * innerRatio;

  let angle = -Math.PI / 2;

  const arcs = slices.map((s) => {
    const frac = s.value / total;
    const delta = frac * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + delta;
    angle = a1;

    const large = delta > Math.PI ? 1 : 0;

    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;

    const ix0 = cx + Math.cos(a1) * ir;
    const iy0 = cy + Math.sin(a1) * ir;
    const ix1 = cx + Math.cos(a0) * ir;
    const iy1 = cy + Math.sin(a0) * ir;

    const d = [
      `M ${x0.toFixed(1)} ${y0.toFixed(1)}`,
      `A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`,
      `L ${ix0.toFixed(1)} ${iy0.toFixed(1)}`,
      `A ${ir} ${ir} 0 ${large} 0 ${ix1.toFixed(1)} ${iy1.toFixed(1)}`,
      "Z",
    ].join(" ");

    return { d, slice: s, frac };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" aria-hidden>
      {arcs.map(({ d, slice }) => (
        <path
          key={slice.key}
          d={d}
          fill={slice.color}
          stroke="rgba(10,5,24,0.85)"
          strokeWidth={2}
        />
      ))}
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize={10}
        fill="#A599C8"
        style={{ textTransform: "uppercase", letterSpacing: "0.2em" }}
      >
        Total
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontSize={22}
        fontWeight={600}
        fill="#EDE7FF"
      >
        {total.toLocaleString()}
      </text>
    </svg>
  );
}

export function PieLegend({ slices }: { slices: PieSlice[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
      {slices.map((s) => {
        const pct = ((s.value / total) * 100).toFixed(1);
        return (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: s.color }}
              />
              <span className="truncate text-muted">{s.label}</span>
            </span>
            <span className="shrink-0 text-text tabular-nums">{pct}%</span>
          </li>
        );
      })}
    </ul>
  );
}
