export type RadarDatum = { label: string; value: number };

export function Radar({
  data,
  size = 240,
  max = 100,
}: {
  data: RadarDatum[];
  size?: number;
  max?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 24;
  const angle = (i: number) => (Math.PI * 2 * i) / data.length - Math.PI / 2;

  const axisPoint = (i: number, t: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * t, cy + Math.sin(a) * r * t] as const;
  };

  const polygon = data
    .map((d, i) => {
      const [x, y] = axisPoint(i, Math.max(0, Math.min(1, d.value / max)));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="radar-fill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.45" />
          <stop offset="55%" stopColor="#34D399" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#EC4899" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id="radar-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5EEAD4" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>

      {rings.map((t) => (
        <polygon
          key={t}
          points={data
            .map((_, i) => {
              const [x, y] = axisPoint(i, t);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />
      ))}

      {data.map((d, i) => {
        const [x, y] = axisPoint(i, 1);
        return (
          <line
            key={d.label}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
        );
      })}

      <polygon
        points={polygon}
        fill="url(#radar-fill)"
        stroke="url(#radar-stroke)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {data.map((d, i) => {
        const [x, y] = axisPoint(i, Math.max(0, Math.min(1, d.value / max)));
        return (
          <circle key={d.label + "-dot"} cx={x} cy={y} r={3} fill="#E8FAFF" />
        );
      })}

      {data.map((d, i) => {
        const [x, y] = axisPoint(i, 1.15);
        const anchor = x < cx - 4 ? "end" : x > cx + 4 ? "start" : "middle";
        return (
          <text
            key={"lbl-" + d.label}
            x={x}
            y={y}
            fontFamily="var(--font-mono)"
            fontSize={9}
            fontWeight={600}
            textAnchor={anchor}
            dominantBaseline="middle"
            fill="#9BC9D9"
            style={{ textTransform: "uppercase", letterSpacing: "0.14em" }}
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}
