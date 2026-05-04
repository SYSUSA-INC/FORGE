/**
 * One of the two launcher choices on /proposals/new — a single card
 * with an eyebrow tag, a heading, a brief description, and the
 * action area as children. Server component (no client state).
 */
export function LauncherCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="aur-card flex flex-col p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-teal">
        {eyebrow}
      </div>
      <div className="mt-1 font-display text-[18px] font-semibold text-text">
        {title}
      </div>
      <p className="mt-1.5 font-body text-[13px] leading-relaxed text-muted">
        {description}
      </p>
      <div className="mt-4 flex flex-col gap-2">{children}</div>
    </div>
  );
}
