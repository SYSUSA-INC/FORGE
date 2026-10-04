"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ADDON_LIMITS,
  describeAddon,
  formatMonthlyPrice,
  type AddonCatalogRow,
  type TenantAddonRow,
} from "@/lib/addons-logic";
import { grantAddonAction, revokeAddonAction } from "./addon-actions";

/**
 * BL-PACKAGES add-ons Slice 1 — a tenant's add-on grants on
 * /admin/orgs/[id]: what they hold (manual or bought), a grant form and
 * a revoke per active row.
 */
export function TenantAddonsPanel({
  organizationId,
  grants,
  catalog,
}: {
  organizationId: string;
  grants: TenantAddonRow[];
  catalog: AddonCatalogRow[];
}) {
  const router = useRouter();
  const [addonId, setAddonId] = useState(catalog[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function grant(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < ADDON_LIMITS.quantity.min || qty > ADDON_LIMITS.quantity.max) {
      return setError(`Quantity: a whole number from ${ADDON_LIMITS.quantity.min} to ${ADDON_LIMITS.quantity.max}.`);
    }
    const addon = catalog.find((a) => a.id === addonId);
    if (!addon) return setError("Pick an add-on.");
    if (!window.confirm(`Grant "${addon.name}" ×${qty} to this tenant? It counts immediately and is recorded in the tenant's audit log.`)) return;
    startTransition(async () => {
      const res = await grantAddonAction({ organizationId, addonId, quantity: qty, note, endsAt: endsAt || null });
      if (!res.ok) return setError(res.error);
      setNotice(`Granted ${addon.name} ×${qty}.`);
      setNote("");
      setEndsAt("");
      router.refresh();
    });
  }

  function revoke(row: TenantAddonRow) {
    setError(null);
    setNotice(null);
    const warning =
      row.source === "stripe"
        ? `End "${row.name}" for this tenant now? It stops counting immediately, but Stripe keeps billing until the subscription is cancelled in Stripe.`
        : `End "${row.name}" for this tenant now? It stops counting immediately.`;
    if (!window.confirm(warning)) return;
    startTransition(async () => {
      const res = await revokeAddonAction({ organizationId, tenantAddonId: row.id });
      if (!res.ok) return setError(res.error);
      setNotice(res.source === "stripe" ? `Ended ${row.name}. Cancel its Stripe subscription too, or billing continues.` : `Ended ${row.name}.`);
      router.refresh();
    });
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-3">
      {grants.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">No add-ons granted or bought.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {grants.map((g) => (
            <li key={g.id} className={`rounded-md border px-3 py-2 ${g.live ? "border-layer/10 bg-layer/[0.02]" : "border-layer/5 bg-layer/[0.01] opacity-70"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                  <span className="text-text">{g.name}</span>
                  {g.quantity > 1 ? <span className="text-muted">×{g.quantity}</span> : null}
                  <span className="rounded border border-layer/10 bg-layer/5 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted">{g.source === "stripe" ? "Stripe" : "Granted"}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${g.live ? "bg-emerald/15 text-emerald" : "bg-layer/10 text-muted"}`}>{g.live ? "Live" : g.status === "canceled" ? "Ended" : "Not counting"}</span>
                </div>
                {g.status === "active" ? (
                  <button type="button" onClick={() => revoke(g)} disabled={pending} className="aur-btn aur-btn-ghost text-[10px] disabled:opacity-60">
                    End now
                  </button>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] text-muted">
                <span>{describeAddon(g, g.quantity)}</span>
                <span>{formatMonthlyPrice(g.priceMonthlyCents * g.quantity)}</span>
                <span>since {date(g.startsAt)}</span>
                {g.endsAt ? <span>{g.status === "canceled" ? "serves until" : "ends"} {date(g.endsAt)}</span> : null}
                {g.note ? <span className="text-muted/80">“{g.note}”</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {catalog.length > 0 ? (
        <form onSubmit={grant} className="mt-1 flex flex-col gap-2">
          <label className="aur-label">Grant an add-on</label>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_90px_1fr_150px_auto]">
            <select className="aur-input" value={addonId} onChange={(e) => setAddonId(e.target.value)} disabled={pending}>
              {catalog.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {describeAddon(a)}
                </option>
              ))}
            </select>
            <input className="aur-input" type="number" min={ADDON_LIMITS.quantity.min} max={ADDON_LIMITS.quantity.max} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={pending} title="Quantity" />
            <input className="aur-input" value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} placeholder="Note (why; e.g. pilot through Q4)" maxLength={ADDON_LIMITS.noteMax} />
            <input className="aur-input" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={pending} title="Ends on (optional)" />
            <button type="submit" disabled={pending || !addonId} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60">
              {pending ? "Saving…" : "Grant"}
            </button>
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-muted/80">
            Audited as <code>tenant.addon.grant</code> / <code>tenant.addon.revoke</code> in the tenant&apos;s audit log. Leave the date empty for an open-ended grant.
          </p>
        </form>
      ) : (
        <p className="font-mono text-[10px] text-muted">No active add-ons in the catalogue. Create one under /admin/tiers first.</p>
      )}

      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">{notice}</div> : null}
    </div>
  );
}
