import { ReactNode } from "react";

export function Panel({
  title,
  code,
  actions,
  children,
  accent,
  className,
  dense,
}: {
  title: string;
  code?: string;
  actions?: ReactNode;
  children: ReactNode;
  accent?: "ink" | "hazard" | "blood" | "signal" | "cobalt";
  className?: string;
  dense?: boolean;
}) {
  const accentClass =
    accent === "hazard"
      ? "bg-hazard text-ink"
      : accent === "blood"
        ? "bg-blood text-paper"
        : accent === "signal"
          ? "bg-signal text-ink"
          : accent === "cobalt"
            ? "bg-cobalt text-paper"
            : "bg-ink text-paper";

  return (
    <section className={`brut-card ${className ?? ""}`}>
      <header
        className={`flex items-center justify-between border-b-2 border-ink px-4 py-2 ${accentClass}`}
      >
        <div className="flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
          {code ? <span className="opacity-70">[{code}]</span> : null}
          <span>{title}</span>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className={dense ? "p-0" : "p-5"}>{children}</div>
    </section>
  );
}
