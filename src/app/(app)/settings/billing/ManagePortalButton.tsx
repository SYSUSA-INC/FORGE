"use client";

import { useState, useTransition } from "react";
import { createPortalSessionAction } from "./actions";

/**
 * BL-17 Slice 4 — "Manage subscription" button.
 *
 * Opens the Stripe Customer Portal in the same tab via hard redirect.
 * Only renders when the tenant has an existing Stripe Customer
 * (`hasStripeCustomer` from the parent); otherwise the Upgrade
 * cards below are the path forward.
 */
export function ManagePortalButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const res = await createPortalSessionAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.href = res.url;
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
      >
        {pending ? "Opening…" : "Manage subscription →"}
      </button>
      {error ? (
        <span className="font-mono text-[10px] text-rose">{error}</span>
      ) : null}
    </div>
  );
}
