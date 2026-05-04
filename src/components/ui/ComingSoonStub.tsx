import Link from "next/link";

/**
 * Placeholder for routes that exist in the nav but whose backing
 * feature isn't built yet. Used during Chapter 16 rollout so the
 * sidebar links resolve cleanly while the underlying pages catch up.
 *
 * Renders a single amber callout with the planned scope and a back
 * link. Drop the import and the route file when the real page lands.
 */
export function ComingSoonStub({
  title,
  eyebrow,
  description,
  scheduledIn,
  backHref = "/",
  backLabel = "Back to Command Center",
}: {
  title: string;
  eyebrow: string;
  description: string;
  scheduledIn: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
        {eyebrow}
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
        {title}
      </h1>

      <div className="mt-6 rounded-lg border border-amber-400/40 bg-amber-400/[0.06] px-5 py-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-400/60 bg-amber-400/20 font-mono text-[10px] font-bold text-amber-300"
          >
            !
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
              Coming soon · {scheduledIn}
            </div>
            <p className="mt-2 font-body text-[14px] leading-relaxed text-text">
              {description}
            </p>
            <Link
              href={backHref}
              className="mt-4 inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-amber-300 underline decoration-dotted underline-offset-2 hover:text-amber-200"
            >
              {backLabel} →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
