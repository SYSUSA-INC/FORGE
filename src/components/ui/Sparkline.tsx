export function Sparkline({
  data,
  width = 200,
  height = 60,
  color = "#0A0A0A",
  fill = "#FFD500",
  area = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
  area?: boolean;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1 || 1);
  const pts = data.map((d, i) => {
    const x = i * step;
    const y = height - ((d - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none" aria-hidden>
      {area ? <path d={areaPath} fill={fill} fillOpacity={0.85} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="miter" strokeLinecap="square" />
      {pts.map(([x, y], i) => (
        <rect key={i} x={x - 1.5} y={y - 1.5} width={3} height={3} fill={color} />
      ))}
    </svg>
  );
}

export function BarSpark({
  data,
  color = "bg-ink",
  active = "bg-blood",
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
    <div className="flex items-end gap-[2px] border-2 border-ink bg-paper p-1" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 ${i === peak ? active : color}`}
          style={{ height: `${(v / max) * 100}%` }}
        />
      ))}
    </div>
  );
}
