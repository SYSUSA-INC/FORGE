export function Stamp({
  label,
  tone = "blood",
  angle = -7,
  className = "",
}: {
  label: string;
  tone?: "blood" | "ink" | "signal" | "hazard";
  angle?: number;
  className?: string;
}) {
  const color =
    tone === "blood"
      ? "text-blood"
      : tone === "signal"
        ? "text-signal"
        : tone === "hazard"
          ? "text-hazard"
          : "text-ink";

  return (
    <span
      className={`inline-flex select-none items-center justify-center border-[3px] px-2.5 py-1 font-display text-[11px] font-black uppercase tracking-[0.18em] opacity-90 ${color} ${className}`}
      style={{ transform: `rotate(${angle}deg)` }}
    >
      <span className="pr-1">✦</span>
      {label}
      <span className="pl-1">✦</span>
    </span>
  );
}
