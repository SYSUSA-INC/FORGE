"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TierFeatureFlags } from "@/db/schema";
import {
  ADDON_FLAG_KEYS,
  ADDON_FLAG_LABELS,
  ADDON_KIND_LABELS,
  describeAddon,
  formatMonthlyPrice,
  type AddonCatalogRow,
  type AddonKind,
} from "@/lib/addons-logic";
import { createAddonAction, updateAddonAction } from "./addon-actions";

/**
 * BL-PACKAGES add-ons Slice 1 — the catalogue list with an inline
 * editor per row and a "new add-on" form. Platform admins only (the
 * page gates; the actions gate again).
 */
export function AddonCatalogPanel({ addons, activeGrants }: { addons: AddonCatalogRow[]; activeGrants: Record<string, number> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {addons.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">No add-ons yet. Create a token top-up or a feature unlock below.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {addons.map((a) => (
            <li key={a.id} className="rounded-lg border border-layer/10 bg-layer/[0.02] p-3">
              {editing === a.id ? (
                <AddonForm initial={a} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-display text-[14px] font-semibold text-text">{a.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{a.slug}</span>
                      <span className="rounded border border-layer/10 bg-layer/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">{ADDON_KIND_LABELS[a.kind]}</span>
                      {!a.active ? <span className="rounded bg-rose/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-rose">Retired</span> : null}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-text">{describeAddon(a)}</div>
                    {a.description ? <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted">{a.description}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] text-muted">
                      <span>{formatMonthlyPrice(a.priceMonthlyCents)}</span>
                      <span>{a.stripePriceId ? `Stripe ${a.stripePriceId}` : "Not sold by card (grant only)"}</span>
                      <span>Active grants: <span className="text-text tabular-nums">{activeGrants[a.id] ?? 0}</span></span>
                      <span className="text-muted/70">sort_order {a.sortOrder}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => setEditing(a.id)} className="aur-btn aur-btn-ghost text-[11px]">
                    Edit →
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <div className="rounded-lg border border-indigo-400/30 bg-indigo-400/5 p-3">
          <AddonForm initial={null} onDone={() => setCreating(false)} />
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setCreating(true)} className="aur-btn aur-btn-primary text-[11px]">
            + New add-on
          </button>
        </div>
      )}
    </div>
  );
}

function AddonForm({ initial, onDone }: { initial: AddonCatalogRow | null; onDone: () => void }) {
  const router = useRouter();
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<AddonKind>(initial?.kind ?? "ai_tokens");
  const [tokens, setTokens] = useState(String(initial?.aiTokensPerMonth ?? 500000));
  const [amount, setAmount] = useState(String(initial?.amountPerUnit || 5));
  const [flag, setFlag] = useState<keyof TierFeatureFlags>(initial?.featureFlag ?? "winnerAnalysis");
  const [price, setPrice] = useState(((initial?.priceMonthlyCents ?? 0) / 100).toString());
  const [stripePriceId, setStripePriceId] = useState(initial?.stripePriceId ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const dollars = Number(price);
    const sort = Number(sortOrder);
    const tok = Number(tokens);
    if (!Number.isFinite(dollars) || dollars < 0) return setError("Price must be a non-negative number of dollars.");
    if (!Number.isFinite(sort)) return setError("Sort order must be a whole number.");
    if (kind === "ai_tokens" && (!Number.isFinite(tok) || tok <= 0)) return setError("Tokens per month must be a positive whole number.");
    const amt = Number(amount);
    const sized = kind === "seats" || kind === "storage";
    if (sized && (!Number.isInteger(amt) || amt <= 0)) return setError(`${kind === "seats" ? "Seats" : "GB"} per unit must be a positive whole number.`);
    const payload = {
      slug: slug.trim().toLowerCase(),
      name: name.trim(),
      description: description.trim(),
      kind,
      aiTokensPerMonth: kind === "ai_tokens" ? Math.round(tok) : 0,
      featureFlag: kind === "feature" ? flag : null,
      amountPerUnit: sized ? amt : 0,
      priceMonthlyCents: Math.round(dollars * 100),
      stripePriceId: stripePriceId.trim(),
      sortOrder: Math.round(sort),
      active,
    };
    startTransition(async () => {
      const res = initial ? await updateAddonAction(initial.id, payload) : await createAddonAction(payload);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="aur-label">Slug</label>
          <input className="aur-input" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!!initial || pending} placeholder="ai-tokens-500k" />
          {initial ? <div className="mt-1 font-mono text-[10px] text-muted">Slugs don&apos;t change; Stripe metadata references them.</div> : null}
        </div>
        <div>
          <label className="aur-label">Name</label>
          <input className="aur-input" value={name} onChange={(e) => setName(e.target.value)} disabled={pending} placeholder="500K AI token top-up" />
        </div>
        <div>
          <label className="aur-label">Kind</label>
          <select className="aur-input" value={kind} onChange={(e) => setKind(e.target.value as AddonKind)} disabled={pending}>
            {(Object.keys(ADDON_KIND_LABELS) as AddonKind[]).map((k) => (
              <option key={k} value={k}>
                {ADDON_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {kind === "ai_tokens" ? (
          <div>
            <label className="aur-label">Extra AI tokens / month (per unit)</label>
            <input className="aur-input" type="number" min={1} step={1} value={tokens} onChange={(e) => setTokens(e.target.value)} disabled={pending} />
          </div>
        ) : kind === "seats" || kind === "storage" ? (
          <div>
            <label className="aur-label">{kind === "seats" ? "Extra seats (per unit)" : "Extra storage, GB (per unit)"}</label>
            <input className="aur-input" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={pending} />
          </div>
        ) : (
          <div>
            <label className="aur-label">Feature it unlocks</label>
            <select className="aur-input" value={flag} onChange={(e) => setFlag(e.target.value as keyof TierFeatureFlags)} disabled={pending}>
              {ADDON_FLAG_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ADDON_FLAG_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="aur-label">Price (USD / month)</label>
          <input className="aur-input" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} disabled={pending} />
        </div>
        <div>
          <label className="aur-label">Stripe Price id (monthly, optional)</label>
          <input className="aur-input" value={stripePriceId} onChange={(e) => setStripePriceId(e.target.value)} disabled={pending} placeholder="price_…" />
        </div>
        <div className="md:col-span-2">
          <label className="aur-label">Description (shown to tenants)</label>
          <input className="aur-input" value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} />
        </div>
        <div className="flex items-end gap-4">
          <div>
            <label className="aur-label">Sort order</label>
            <input className="aur-input w-24" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={pending} />
          </div>
          <label className="flex items-center gap-2 pb-2 font-mono text-[11px] text-text">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={pending} />
            Active
          </label>
        </div>
      </div>
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60">
          {pending ? "Saving…" : initial ? "Save" : "Create add-on"}
        </button>
        <button type="button" onClick={onDone} disabled={pending} className="aur-btn aur-btn-ghost text-[11px]">
          Cancel
        </button>
      </div>
    </form>
  );
}
