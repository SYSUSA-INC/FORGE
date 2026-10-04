"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ADDON_LIMITS } from "@/lib/addons-logic";
import { createAddonCheckoutSessionAction } from "./actions";

/**
 * BL-PACKAGES add-ons — buy an add-on. Token top-ups take a quantity.
 * On a card-paid plan the server adds it to the plan's subscription
 * (Slice 2a) and we just refresh; otherwise it mints a Stripe Checkout
 * Session and we hard-redirect to it, like the plan buttons.
 */
export function AddonCheckoutButton({ addonSlug, addonName, stackable }: { addonSlug: string; addonName: string; stackable: boolean }) {
  const [quantity, setQuantity] = useState(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  function buy() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await createAddonCheckoutSessionAction({ addonSlug, quantity });
      if (!res.ok) return setError(res.error);
      if (res.url !== null) {
        window.location.href = res.url;
        return;
      }
      setDone(res.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {stackable ? (
        <input
          className="aur-input w-20"
          type="number"
          min={ADDON_LIMITS.quantity.min}
          max={ADDON_LIMITS.quantity.max}
          step={1}
          value={quantity}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            setQuantity(Number.isFinite(n) ? Math.min(ADDON_LIMITS.quantity.max, Math.max(ADDON_LIMITS.quantity.min, n)) : 1);
          }}
          disabled={pending}
          title="How many"
        />
      ) : null}
      <button type="button" onClick={buy} disabled={pending} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50">
        {pending ? "Working…" : `Add ${addonName}`}
      </button>
      {error ? <span className="font-mono text-[10px] text-rose">{error}</span> : null}
      {done ? <span className="font-mono text-[10px] text-emerald">{done}</span> : null}
    </div>
  );
}
