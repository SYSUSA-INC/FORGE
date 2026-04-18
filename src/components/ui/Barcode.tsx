export function Barcode({
  value,
  className = "",
  height = 28,
}: {
  value: string;
  className?: string;
  height?: number;
}) {
  const bars: { w: number }[] = [];
  let seed = 0;
  for (let i = 0; i < value.length; i++) seed = (seed * 131 + value.charCodeAt(i)) >>> 0;
  for (let i = 0; i < 46; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const w = 1 + (seed % 5);
    bars.push({ w });
  }
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-end gap-[1.5px]" style={{ height }}>
        {bars.map((b, i) => (
          <span
            key={i}
            className="bg-ink"
            style={{ width: b.w, height: i % 5 === 0 ? height : height - 4 }}
          />
        ))}
      </div>
      <span className="font-mono text-[9px] uppercase tracking-[0.35em] text-ink/70">{value}</span>
    </div>
  );
}
