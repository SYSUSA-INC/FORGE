import { ReactNode } from "react";

export function Panel({
  title,
  code,
  actions,
  children,
  accent,
  className,
  dense,
  corner = true,
}: {
  title: string;
  code?: string;
  actions?: ReactNode;
  children: ReactNode;
  accent?: "ink" | "hazard" | "blood" | "signal" | "cobalt" | "plum";
  className?: string;
  dense?: boolean;
  corner?: boolean;
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
            : accent === "plum"
              ? "bg-plum text-paper"
              : "bg-ink text-paper";

  return (
    <section className={`brut-card relative ${className ?? ""}`}>
      <header
        className={`relative flex items-center justify-between border-b-2 border-ink px-4 py-2 ${accentClass}`}
      >
        <div className="flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
          {code ? (
            <span className="border-2 border-current/50 bg-current/10 px-1.5 py-0.5 font-mono text-[10px]">
              {code}
            </span>
          ) : null}
          <span>{title}</span>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        {corner ? (
          <span className="pointer-events-none absolute -bottom-[2px] -right-[2px] h-2 w-2 border-b-2 border-r-2 border-current" />
        ) : null}
      </header>
      <div className={dense ? "p-0" : "p-5"}>{children}</div>
    </section>
  );
}
