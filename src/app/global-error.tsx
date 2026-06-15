"use client";

import { useEffect } from "react";

/**
 * Root error boundary — catches anything Next.js can't (including
 * errors thrown during root-layout rendering). Reports the error to
 * the in-app error log so it lands at `/admin/errors`, then renders
 * a minimal fallback.
 *
 * Next.js requires this file to define its own <html> + <body>
 * because the root layout has failed by the time it renders.
 *
 * Companion: `src/app/(app)/error.tsx` catches errors inside the
 * authenticated app shell with a friendlier in-shell fallback.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Fire-and-forget. We deliberately don't await — if the report
    // call itself fails (network down, route 500), the user already
    // sees a broken page; we shouldn't compound it.
    void fetch("/api/error-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack ?? "",
        digest: error.digest ?? "",
        path:
          typeof window !== "undefined" ? window.location.pathname : "",
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : "",
      }),
    }).catch(() => {
      // Swallow — nothing more we can do client-side.
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          padding: "48px 24px",
          maxWidth: 640,
          margin: "0 auto",
          color: "#1c1c1f",
          backgroundColor: "#fafafa",
          minHeight: "100vh",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Something went wrong.
        </h1>
        <p
          style={{
            color: "#666",
            marginBottom: 24,
            lineHeight: 1.5,
          }}
        >
          The page hit an unexpected error. It has been logged for our
          team to investigate. You can try again or reload the page.
        </p>
        {error.digest ? (
          <p
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              color: "#888",
              marginBottom: 24,
            }}
          >
            Reference: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "8px 16px",
            border: "1px solid #1c1c1f",
            backgroundColor: "#1c1c1f",
            color: "#fff",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
