export function DotMeter({
  value,
  max = 100,
  steps = 20,
  filled = "bg-violet",
  empty = "bg-white/10",
  highlight,
  className = "",
}: {
  value: number;
  max?: number;
  steps?: number;
  filled?: string;
  empty?: string;
  highlight?: string;
  className?: string;
}) {
  const on = Math.round((Math.max(0, Math.min(max, value)) / max) * steps);
  const cells = Array.from({ length: steps });
  return (
    <div className={`flex gap-[2px] rounded-md border border-white/10 bg-white/[0.04] p-[3px] ${className}`}>
      {cells.map((_, i) => (
        <span
          key={i}
          className={`h-2.5 flex-1 rounded-[2px] ${
            i < on ? (highlight && i === on - 1 ? highlight : filled) : empty
          }`}
        />
      ))}
    </div>
  );
}
