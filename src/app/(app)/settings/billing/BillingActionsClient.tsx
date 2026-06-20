"use client";

import { useState, useTransition } from "react";
import { createCheckoutSessionAction } from "./actions";

/**
 * BL-17 Slice 3 — per-tier Checkout button.
 *
 * Renders monthly / yearly options based on which Stripe prices are
 * configured for the tier. On click, calls the server action to mint
 * a Stripe Checkout Session and hard-redirects to the hosted URL.
 *
 * Error rendering is inline (small) — the page's larger flash banners
 * are reserved for post-checkout-return surfaces.
 */
export function BillingActionsClient({
  tierSlug,
  tierName,
  monthlyAvailable,
  yearlyAvailable,
  isUpgrade,
}: {
  tierSlug: string;
  tierName: string;
  monthlyAvailable: boolean;
  yearlyAvailable: boolean;
  isUpgrade: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function checkout(period: "monthly" | "yearly") {
    setError(null);
    startTransition(async () => {
      const res = await createCheckoutSessionAction({ tierSlug, period });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Hard navigation to Stripe-hosted Checkout — leaves the SPA.
      window.location.href = res.url;
    });
  }

  const label = isUpgrade ? `Upgrade to ${tierName}` : `Switch to ${tierName}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {monthlyAvailable ? (
        <button
          type="button"
          onClick={() => checkout("monthly")}
          disabled={pending}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50"
        >
          {pending ? "Redirecting…" : `${label} (monthly)`}
        </button>
      ) : null}
      {yearlyAvailable ? (
        <button
          type="button"
          onClick={() => checkout("yearly")}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
        >
          {`${label} (yearly)`}
        </button>
      ) : null}
      {error ? (
        <span className="font-mono text-[10px] text-rose">{error}</span>
      ) : null}
    </div>
  );
}
