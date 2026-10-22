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
  // EnableNow cards carry no coloured edge: a panel about a problem says so
  // in its label (danger or attention), everything else stays quiet.
  const eyebrowTone =
    accent === "hazard" || accent === "gold"
      ? "text-gold"
      : accent === "blood" || accent === "rose"
        ? "text-rose"
        : "text-muted";

  return (
    <section
      className={`${elevated ? "aur-card-elevated" : "aur-card"} overflow-hidden ${className ?? ""}`}
    >

      {(title || eyebrow || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-layer/10 px-5 py-3">
          <div className="min-w-0">
            {eyebrow ? (
              <div className={`font-mono text-[10px] uppercase tracking-label ${eyebrowTone}`}>
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <div className="font-display text-[14px] font-medium tracking-tight text-text">
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
