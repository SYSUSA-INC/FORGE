"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TierFeatureFlags, TierQuotas } from "@/db/schema";
import { updateTierAction } from "./actions";

type Initial = {
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  featureFlags: TierFeatureFlags;
  quotas: TierQuotas;
  sortOrder: number;
  active: boolean;
};

const FLAG_LABELS: Record<keyof TierFeatureFlags, string> = {
  aiAutoDraft: "AI auto-draft",
  winnerAnalysis: "Winner analysis",
  complianceMatrix: "Compliance matrix",
  bulkExport: "Bulk export",
  apiAccess: "API access",
  customTemplates: "Custom templates",
};

const QUOTA_LABELS: Record<keyof TierQuotas, string> = {
  aiRequestsPerMonth: "AI requests/month",
  seatsIncluded: "Seats included",
  storageGb: "Storage (GB)",
  proposalsPerMonth: "Proposals/month",
};

export function TierEditForm({
  tierId,
  tierSlug,
  tenantCount,
  initial,
}: {
  tierId: string;
  tierSlug: string;
  tenantCount: number;
  initial: Initial;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  // Prices stored as dollars in the form UI; converted to cents on submit.
  const [priceMonthly, setPriceMonthly] = useState(
    (initial.priceMonthlyCents / 100).toString(),
  );
  const [priceYearly, setPriceYearly] = useState(
    (initial.priceYearlyCents / 100).toString(),
  );
  const [flags, setFlags] = useState<TierFeatureFlags>(initial.featureFlags);
  const [quotas, setQuotas] = useState<TierQuotas>(initial.quotas);
  const [sortOrder, setSortOrder] = useState(initial.sortOrder.toString());
  const [active, setActive] = useState(initial.active);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleFlag(key: keyof TierFeatureFlags) {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function updateQuota(key: keyof TierQuotas, value: string) {
    const n = value.trim() === "" ? 0 : Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    setQuotas((prev) => ({ ...prev, [key]: Math.round(n) }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const monthly = Number(priceMonthly);
    const yearly = Number(priceYearly);
    const sort = Number(sortOrder);
    if (!Number.isFinite(monthly) || monthly < 0) {
      setError("Monthly price must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(yearly) || yearly < 0) {
      setError("Yearly price must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(sort)) {
      setError("Sort order must be a whole number.");
      return;
    }

    if (initial.active && !active && tenantCount > 0) {
      setError(
        `Cannot retire this tier — ${tenantCount} tenant(s) are still on it. Reassign them first.`,
      );
      return;
    }

    startTransition(async () => {
      const res = await updateTierAction(tierId, {
        name: name.trim(),
        description: description.trim(),
        priceMonthlyCents: Math.round(monthly * 100),
        priceYearlyCents: Math.round(yearly * 100),
        featureFlags: flags,
        quotas,
        sortOrder: Math.round(sort),
        active,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Saved.");
      router.refresh();
    });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="aur-label">Name</span>
          <input
            className="aur-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="aur-label">Slug (read-only)</span>
          <input
            className="aur-input opacity-60"
            value={tierSlug}
            disabled
            readOnly
          />
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="aur-label">Description</span>
        <textarea
          className="aur-input min-h-[60px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="aur-label">Price (monthly, USD)</span>
          <input
            className="aur-input"
            type="number"
            min="0"
            step="1"
            value={priceMonthly}
            onChange={(e) => setPriceMonthly(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">Price (yearly, USD)</span>
          <input
            className="aur-input"
            type="number"
            min="0"
            step="1"
            value={priceYearly}
            onChange={(e) => setPriceYearly(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="aur-label">Sort order</span>
          <input
            className="aur-input"
            type="number"
            step="1"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </label>
      </div>

      <fieldset className="rounded-md border border-white/10 p-3">
        <legend className="px-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Feature flags
        </legend>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(Object.entries(FLAG_LABELS) as Array<
            [keyof TierFeatureFlags, string]
          >).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 rounded border border-white/5 bg-white/[0.02] px-3 py-2"
            >
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={() => toggleFlag(key)}
              />
              <span className="font-mono text-[12px] text-text">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-white/10 p-3">
        <legend className="px-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Quotas (0 = unlimited)
        </legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(Object.entries(QUOTA_LABELS) as Array<
            [keyof TierQuotas, string]
          >).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="aur-label">{label}</span>
              <input
                className="aur-input"
                type="number"
                min="0"
                step="1"
                value={String(quotas[key])}
                onChange={(e) => updateQuota(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <span className="font-mono text-[12px] text-text">
          Active — uncheck to retire this tier (refused server-side if tenants
          are still on it)
        </span>
      </label>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          className="aur-btn aur-btn-primary disabled:opacity-60"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
