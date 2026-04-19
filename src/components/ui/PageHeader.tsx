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
  meta?: {
    label: string;
    value: string;
    accent?: "ink" | "hazard" | "blood" | "signal" | "cobalt" | "plum" | "violet" | "emerald" | "gold" | "rose" | "magenta";
  }[];
}) {
  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "linear-gradient(90deg, #2DD4BF, #34D399 55%, #EC4899)" }}
            />
            {eyebrow}
          </div>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-text md:text-5xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {meta && meta.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {meta.map((m) => (
            <MetaTile key={m.label} {...m} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MetaTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?:
    | "ink"
    | "hazard"
    | "blood"
    | "signal"
    | "cobalt"
    | "plum"
    | "violet"
    | "emerald"
    | "gold"
    | "rose"
    | "magenta";
}) {
  const tone =
    accent === "hazard" || accent === "gold"
      ? "text-gold"
      : accent === "blood" || accent === "rose"
        ? "text-rose"
        : accent === "signal" || accent === "emerald"
          ? "text-emerald"
          : accent === "cobalt" || accent === "violet"
            ? "text-violet"
            : accent === "plum" || accent === "magenta"
              ? "text-magenta"
              : "text-text";

  const glow =
    accent === "hazard" || accent === "gold"
      ? "shadow-glow-gold"
      : accent === "signal" || accent === "emerald"
        ? "shadow-glow-emerald"
        : accent === "cobalt" || accent === "violet" || accent === "plum" || accent === "magenta"
          ? "shadow-glow"
          : "";

  return (
    <div className={`aur-card px-4 py-3 ${glow}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>
        {value}
      </div>
    </div>
  );
}
