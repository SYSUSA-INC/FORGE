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
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-full w-full"
      aria-hidden
    >
      {/* Grid rings as nested polygons for brutalist feel */}
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
          stroke="#0A0A0A"
          strokeOpacity={t === 1 ? 1 : 0.2}
          strokeWidth={t === 1 ? 2 : 1}
        />
      ))}

      {/* Axes */}
      {data.map((d, i) => {
        const [x, y] = axisPoint(i, 1);
        return (
          <line
            key={d.label}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#0A0A0A"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={polygon}
        fill="#0A0A0A"
        fillOpacity={0.08}
        stroke="#0A0A0A"
        strokeWidth={2}
        strokeLinejoin="miter"
      />

      {/* Data dots */}
      {data.map((d, i) => {
        const [x, y] = axisPoint(i, Math.max(0, Math.min(1, d.value / max)));
        return (
          <g key={d.label}>
            <rect
              x={x - 3}
              y={y - 3}
              width={6}
              height={6}
              fill="#0A0A0A"
            />
          </g>
        );
      })}

      {/* Labels */}
      {data.map((d, i) => {
        const [x, y] = axisPoint(i, 1.15);
        const anchor = x < cx - 4 ? "end" : x > cx + 4 ? "start" : "middle";
        return (
          <text
            key={`lbl-${d.label}`}
            x={x}
            y={y}
            fontFamily="var(--font-mono)"
            fontSize={9}
            fontWeight={700}
            textAnchor={anchor}
            dominantBaseline="middle"
            fill="#0A0A0A"
            style={{ textTransform: "uppercase", letterSpacing: "0.15em" }}
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}
