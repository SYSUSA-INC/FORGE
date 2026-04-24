import { ReactNode } from "react";

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  accent,
  className,
  dense,
  elevated,
}: {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  accent?: "ink" | "hazard" | "blood" | "signal" | "cobalt" | "plum" | "violet" | "emerald" | "gold" | "rose" | "magenta";
  className?: string;
  dense?: boolean;
  elevated?: boolean;
}) {
  const stripe =
    accent === "hazard" || accent === "gold"
      ? "from-gold/80 via-gold/40 to-transparent"
      : accent === "blood" || accent === "rose"
        ? "from-rose/80 via-rose/40 to-transparent"
        : accent === "signal" || accent === "emerald"
          ? "from-emerald/80 via-emerald/40 to-transparent"
          : accent === "plum" || accent === "magenta"
            ? "from-magenta/80 via-magenta/40 to-transparent"
            : accent === "cobalt" || accent === "violet" || accent === "ink"
              ? "from-violet/80 via-violet/40 to-transparent"
              : "";

  return (
    <section
      className={`${elevated ? "aur-card-elevated" : "aur-card"} overflow-hidden ${className ?? ""}`}
    >
      {accent ? (
        <div
          className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${stripe}`}
          aria-hidden
        />
      ) : null}

      {(title || eyebrow || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <div className="font-display text-[13px] font-semibold tracking-tight text-text">
                {title}
              </div>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={dense ? "p-0" : "p-5"}>{children}</div>
    </section>
  );
}
