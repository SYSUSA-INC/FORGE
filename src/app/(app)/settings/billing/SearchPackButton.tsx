"use client";

import { useState, useTransition } from "react";
import { createSearchPackCheckoutAction } from "./actions";

/**
 * BL-NAV-LIFECYCLE 5b-2b — buy a pack of web searches. The server mints a
 * Stripe Checkout Session (a one-time card payment) and we hard-redirect
 * to it, like the plan buttons.
 */
export function SearchPackButton({ packSlug, label }: { packSlug: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function buy() {
    setError(null);
    startTransition(async () => {
      const res = await createSearchPackCheckoutAction({ packSlug });
      if (!res.ok) return setError(res.error);
      window.location.href = res.url;
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={buy} disabled={pending} className="aur-btn aur-btn-primary disabled:opacity-50">
        {pending ? "Working…" : label}
      </button>
      {error ? <span className="font-mono text-[10px] text-rose">{error}</span> : null}
    </div>
  );
}
