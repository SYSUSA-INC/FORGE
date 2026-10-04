"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ADDON_LIMITS } from "@/lib/addons-logic";
import { changeAddonQuantityAction, removeAddonAction } from "./actions";

/**
 * BL-PACKAGES add-ons Slice 2a — an org admin changes how many of a
 * card-bought top-up the organization has, or removes an add-on. Stripe
 * prorates both; the copy says what happens to the bill.
 */
export function AddonGrantControls({
  tenantAddonId,
  name,
  quantity,
  stackable,
  onPlan,
}: {
  tenantAddonId: string;
  name: string;
  quantity: number;
  stackable: boolean;
  onPlan: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(quantity);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function update() {
    setStatus(null);
    startTransition(async () => {
      const res = await changeAddonQuantityAction({ tenantAddonId, quantity: qty });
      if (!res.ok) return setStatus({ tone: "err", text: res.error });
      setStatus({ tone: "ok", text: "Updated. The difference is prorated on your next invoice." });
      router.refresh();
    });
  }

  function remove() {
    const what = onPlan
      ? `Remove ${name} now? The unused part of this period is credited on your next invoice.`
      : `Cancel ${name}? It stays on until the end of the period you have paid for.`;
    if (!window.confirm(what)) return;
    setStatus(null);
    startTransition(async () => {
      const res = await removeAddonAction(tenantAddonId);
      if (!res.ok) return setStatus({ tone: "err", text: res.error });
      setStatus({ tone: "ok", text: res.message });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {stackable ? (
        <>
          <input
            className="aur-input w-20"
            type="number"
            min={ADDON_LIMITS.quantity.min}
            max={ADDON_LIMITS.quantity.max}
            step={1}
            value={qty}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              setQty(Number.isFinite(n) ? Math.min(ADDON_LIMITS.quantity.max, Math.max(ADDON_LIMITS.quantity.min, n)) : quantity);
            }}
            disabled={pending}
            title="How many you have"
          />
          <button type="button" onClick={update} disabled={pending || qty === quantity} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50">
            Update
          </button>
        </>
      ) : null}
      <button type="button" onClick={remove} disabled={pending} className="aur-btn aur-btn-ghost text-[11px] text-rose disabled:opacity-50">
        {onPlan ? "Remove" : "Cancel"}
      </button>
      {status ? <span className={`font-mono text-[10px] ${status.tone === "ok" ? "text-emerald" : "text-rose"}`}>{status.text}</span> : null}
    </div>
  );
}
