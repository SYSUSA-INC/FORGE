import Link from "next/link";

/**
 * Unified stub-mode indicator. Three variants for different surfaces:
 *
 *   - `inline`   — single amber chip for meta strips (token/usage rows).
 *                  e.g. "stub mode · configure"
 *   - `pill`     — outlined badge for panel headers next to a title.
 *   - `block`    — full callout card; use when stub mode materially
 *                  changes what the user sees (no real AI, fallback HTML
 *                  instead of PDF, etc.).
 *
 * Every variant points users to /settings/integrations so they always
 * have one obvious place to flip a feature live. The amber tone matches
 * PreviewBanner — it signals "degraded but functional", not "error".
 */
export function StubModeBanner({
  variant = "block",
  message,
  envVar,
  className = "",
}: {
  variant?: "inline" | "pill" | "block";
  /** Override the default body copy for `block`. */
  message?: string;
  /** Optional env var name to mention (e.g. "ANTHROPIC_API_KEY"). */
  envVar?: string;
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300 ${className}`}
      >
        <span aria-hidden>●</span>
        <span>stub mode</span>
        <Link
          href="/settings/integrations"
          className="underline decoration-dotted underline-offset-2 hover:text-amber-200"
        >
          configure
        </Link>
      </span>
    );
  }

  if (variant === "pill") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-200 ${className}`}
      >
        stub
      </span>
    );
  }

  const body =
    message ??
    `Running without a configured AI provider — output is a deterministic placeholder, not a real model response.`;

  return (
    <div
      className={`rounded-lg border border-amber-400/50 bg-amber-400/[0.06] px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-400/60 bg-amber-400/20 font-mono text-[10px] font-bold text-amber-300"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
            Stub mode
          </div>
          <p className="mt-1 font-body text-[13px] leading-relaxed text-text">
            {body}
            {envVar ? (
              <>
                {" "}
                Set{" "}
                <code className="rounded bg-black/30 px-1 text-[12px] text-amber-200">
                  {envVar}
                </code>{" "}
                to flip this feature live.
              </>
            ) : null}
          </p>
          <Link
            href="/settings/integrations"
            className="mt-1 inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-amber-300 underline decoration-dotted underline-offset-2 hover:text-amber-200"
          >
            Settings → Integrations →
          </Link>
        </div>
      </div>
    </div>
  );
}
