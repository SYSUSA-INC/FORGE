export function DotMeter({
  value,
  max = 100,
  steps = 20,
  filled = "bg-ink",
  empty = "bg-paper",
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
    <div className={`flex gap-[2px] border-2 border-ink bg-paper p-[2px] ${className}`}>
      {cells.map((_, i) => (
        <span
          key={i}
          className={`h-3 flex-1 ${i < on ? (highlight && i === on - 1 ? highlight : filled) : empty}`}
        />
      ))}
    </div>
  );
}
