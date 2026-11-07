import { ReactNode } from "react";
import Link from "next/link";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
  below,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** A line under the subtitle (the opportunity's source link). */
  below?: ReactNode;
  meta?: {
    label: string;
    value: string;
    accent?: "ink" | "hazard" | "blood" | "signal" | "cobalt" | "plum" | "violet" | "emerald" | "gold" | "rose" | "magenta";
    /** When set, the tile renders as a Link drilling through to this URL. */
    href?: string;
  }[];
}) {
  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-label text-accent">
            <span className="aur-diamond" />
            {eyebrow}
          </div>
          {/* One line at any width (owner, 2026-11-07): a long title ends in … and shows in full on hover. */}
          <h1 title={title} className="mt-2 truncate font-display text-2xl font-normal leading-tight tracking-title text-text md:text-[28px]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
              {subtitle}
            </p>
          ) : null}
          {below ? <div className="mt-1">{below}</div> : null}
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
  href,
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
  href?: string;
}) {
  // Figures are ink; only an error count keeps a hue.
  const tone = accent === "blood" || accent === "rose" ? "text-rose" : "text-text";

  const body = (
    <>
      <div className="font-mono text-[10px] uppercase tracking-label text-muted">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-normal tabular-nums tracking-title ${tone}`}>
        {value}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group block border-t border-layer/10 pt-3 transition-colors hover:border-cobalt"
        title={`View ${label.toLowerCase()}`}
      >
        {body}
        <div className="mt-1 font-mono text-[10px] uppercase tracking-label text-subtle transition-colors group-hover:text-accent">
          View →
        </div>
      </Link>
    );
  }

  return <div className="border-t border-layer/10 pt-3">{body}</div>;
}
