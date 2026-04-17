import { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  meta?: { label: string; value: string; accent?: "ink" | "hazard" | "blood" | "signal" }[];
}) {
  return (
    <div className="mb-8 border-2 border-ink bg-paper shadow-brut-lg">
      <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-5 py-2 text-paper">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em]">
          <span className="h-2 w-2 bg-hazard" />
          {eyebrow}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-paper/60">
          FILE // {new Date().toISOString().slice(0, 10)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <h1 className="font-display text-5xl font-bold leading-[0.9] tracking-tight lg:text-7xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-3 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-wider text-ink/70">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {meta && meta.length > 0 ? (
        <div className="grid grid-cols-2 border-t-2 border-ink md:grid-cols-4">
          {meta.map((m, i) => (
            <div
              key={m.label}
              className={`border-ink p-4 ${i !== meta.length - 1 ? "border-r-2" : ""} ${
                m.accent === "hazard"
                  ? "bg-hazard"
                  : m.accent === "blood"
                    ? "bg-blood text-paper"
                    : m.accent === "signal"
                      ? "bg-signal"
                      : "bg-paper"
              }`}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-70">
                {m.label}
              </div>
              <div className="mt-1 font-display text-2xl font-bold">{m.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
