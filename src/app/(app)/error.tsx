"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * In-shell error boundary for the authenticated app (BL-QC-boot-hook).
 *
 * Catches a page's render error and shows a fallback INSIDE the shell,
 * so the navigation stays usable and the person can move on instead of
 * being dropped on the bare root page. Reports to the in-app error log
 * the same way `src/app/global-error.tsx` does — that root boundary now
 * only handles failures of the layout itself.
 *
 * The `digest` is React's stable hash of the server-side error; it is
 * what `/admin/errors` groups on, and it is safe to show because the
 * message itself is withheld in production.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Fire-and-forget; a failed report must not compound a broken page.
    void fetch("/api/error-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack ?? "",
        digest: error.digest ?? "",
        path: typeof window !== "undefined" ? window.location.pathname : "",
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : "",
      }),
    }).catch(() => {
      // Swallow — nothing more we can do client-side.
    });
  }, [error]);

  return (
    <div className="mx-auto mt-10 max-w-xl rounded-lg border border-layer/10 bg-layer/[0.02] p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
        Something went wrong
      </div>
      <h1 className="mt-2 font-display text-xl font-semibold text-text">
        This page hit an unexpected error.
      </h1>
      <p className="mt-2 font-body text-[13px] leading-relaxed text-muted">
        It has been logged for the team to investigate. The rest of FORGE is
        still available from the menu; you can also retry this page.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[11px] text-subtle">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={reset} className="aur-btn aur-btn-primary">
          Try again
        </button>
        <Link href="/" className="aur-btn aur-btn-ghost">
          Command Center
        </Link>
        <Link href="/admin/errors" className="aur-btn aur-btn-ghost">
          Error log (platform admins)
        </Link>
      </div>
    </div>
  );
}
