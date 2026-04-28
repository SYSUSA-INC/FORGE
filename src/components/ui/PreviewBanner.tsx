/**
 * PreviewBanner — visible callout that a page is aspirational scaffolding,
 * not yet wired to real data. Used on /solicitations and /knowledge-base
 * until those backends ship.
 */
export function PreviewBanner({
  title = "Preview",
  message,
  roadmap,
}: {
  title?: string;
  message: string;
  roadmap?: string;
}) {
  return (
    <div className="mb-4 rounded-lg border border-amber-400/50 bg-amber-400/[0.06] px-4 py-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-400/60 bg-amber-400/20 font-mono text-[10px] font-bold text-amber-300"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
            {title}
          </div>
          <p className="mt-1 font-body text-[13px] leading-relaxed text-text">
            {message}
          </p>
          {roadmap ? (
            <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">
              <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                Roadmap ·{" "}
              </span>
              {roadmap}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
