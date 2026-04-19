export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  valueLow?: number;
  valueHigh?: number;
};

const STAGE_GRADIENTS = [
  ["#C4B5FD", "#A78BFA"],
  ["#A78BFA", "#8B5CF6"],
  ["#8B5CF6", "#7C3AED"],
  ["#7C3AED", "#6D28D9"],
  ["#D946EF", "#A21CAF"],
  ["#F5B544", "#D97706"],
  ["#FB923C", "#EA580C"],
  ["#FB7185", "#BE123C"],
  // Stage 9: Won — emerald + gold celebratory gradient
  ["#6EE7B7", "#F5B544"],
];

export function Funnel({
  stages,
  width = 640,
  height = 540,
}: {
  stages: FunnelStage[];
  width?: number;
  height?: number;
}) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const bandH = height / stages.length;

  const widthFor = (c: number) => {
    const norm = Math.sqrt(c / maxCount);
    return Math.max(0.18, norm) * width;
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label="Pipeline funnel"
      >
        <defs>
          {STAGE_GRADIENTS.map(([a, b], i) => (
            <linearGradient
              key={i}
              id={`funnel-g-${i}`}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor={a} stopOpacity="0.9" />
              <stop offset="100%" stopColor={b} stopOpacity="0.95" />
            </linearGradient>
          ))}
          <filter id="funnel-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {stages.map((s, i) => {
          const topW = widthFor(stages[Math.max(0, i - 1)]?.count ?? s.count);
          const botW = widthFor(s.count);
          const y = i * bandH;
          const cx = width / 2;
          const tl = cx - topW / 2;
          const tr = cx + topW / 2;
          const bl = cx - botW / 2;
          const br = cx + botW / 2;
          const grad = `url(#funnel-g-${i % STAGE_GRADIENTS.length})`;

          const path = `M${tl.toFixed(1)},${y.toFixed(1)} L${tr.toFixed(1)},${y.toFixed(
            1,
          )} L${br.toFixed(1)},${(y + bandH - 4).toFixed(1)} L${bl.toFixed(1)},${(
            y + bandH - 4
          ).toFixed(1)} Z`;

          return (
            <g key={s.key}>
              <path d={path} fill={grad} opacity={0.85} filter="url(#funnel-glow)" />
              <path
                d={path}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1}
              />
              <text
                x={cx}
                y={y + bandH / 2}
                fontFamily="var(--font-mono)"
                fontSize={12}
                fontWeight={700}
                fill="#ffffff"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
              >
                {s.count.toLocaleString()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function FunnelLegend({ stages }: { stages: FunnelStage[] }) {
  const fmt = (n?: number) =>
    typeof n === "number"
      ? n === 0
        ? "$0"
        : n >= 1_000_000
          ? `$${(n / 1_000_000).toFixed(1)}M`
          : n >= 1_000
            ? `$${(n / 1_000).toFixed(0)}K`
            : `$${n}`
      : "—";

  return (
    <ol className="flex flex-col gap-2">
      {stages.map((s, i) => {
        const [a, b] = STAGE_GRADIENTS[i % STAGE_GRADIENTS.length];
        return (
          <li
            key={s.key}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <span
              className="h-6 w-2 rounded-sm"
              style={{ background: `linear-gradient(180deg, ${a}, ${b})` }}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="truncate font-display text-[13px] font-semibold">
                Stage {i + 1} · {s.label}
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                Value {fmt(s.valueLow)} – {fmt(s.valueHigh)}
              </div>
            </div>
            <div className="text-right">
              <div className="font-display text-lg font-semibold tabular-nums">
                {s.count}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted">
                items
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
