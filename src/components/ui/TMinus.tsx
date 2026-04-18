export function TMinus({
  days,
  hours,
  minutes,
  label = "T-MINUS",
  intensity = "hazard",
}: {
  days: number;
  hours: number;
  minutes: number;
  label?: string;
  intensity?: "hazard" | "blood" | "signal" | "ink";
}) {
  const tone =
    intensity === "blood"
      ? "bg-blood text-paper"
      : intensity === "signal"
        ? "bg-signal text-ink"
        : intensity === "ink"
          ? "bg-ink text-paper"
          : "bg-hazard text-ink";

  return (
    <div className={`relative border-2 border-ink ${tone}`}>
      <div className="flex items-center justify-between border-b-2 border-current/70 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em]">
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 animate-blink bg-current" />
          LIVE
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x-2 divide-current/70">
        <Cell label="DAYS" value={String(days).padStart(2, "0")} />
        <Cell label="HRS" value={String(hours).padStart(2, "0")} />
        <Cell label="MIN" value={String(minutes).padStart(2, "0")} />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 text-center">
      <div className="brut-stencil text-6xl">{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.3em] opacity-70">{label}</div>
    </div>
  );
}
