export function Sparkline({
  data,
  width = 220,
  height = 60,
  stroke = "#A78BFA",
  gradientId = "sparkline-fill",
  area = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  gradientId?: string;
  area?: boolean;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1 || 1);
  const pts = data.map((d, i) => {
    const x = i * step;
    const y = height - ((d - min) / span) * (height - 6) - 3;
    return [x, y] as const;
  });

  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {area ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.5} fill={stroke} opacity={i === pts.length - 1 ? 1 : 0.4} />
      ))}
    </svg>
  );
}

export function BarSpark({
  data,
  color = "bg-violet",
  active = "bg-gold",
  peak,
  height = 56,
}: {
  data: number[];
  color?: string;
  active?: string;
  peak?: number;
  height?: number;
}) {
  const max = Math.max(...data, 1);
  return (
    <div
      className="flex items-end gap-[3px] rounded-md border border-white/10 bg-white/[0.03] p-2"
      style={{ height }}
    >
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-[2px] ${i === peak ? active : color}`}
          style={{ height: `${(v / max) * 100}%`, opacity: 0.55 + (v / max) * 0.45 }}
        />
      ))}
    </div>
  );
}
