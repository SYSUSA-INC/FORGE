"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeTenantTierAction } from "./actions";

type TierOption = {
  id: string;
  slug: string;
  name: string;
  priceMonthlyCents: number;
};

export function TierAssignmentForm({
  organizationId,
  currentTierId,
  currentTierName,
  tiers,
}: {
  organizationId: string;
  currentTierId: string;
  currentTierName: string;
  tiers: TierOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(currentTierId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (selected === currentTierId) {
      setError(`Tenant is already on the ${currentTierName} tier.`);
      return;
    }

    const newTier = tiers.find((t) => t.id === selected);
    if (!newTier) {
      setError("Pick a valid tier.");
      return;
    }
    if (
      !window.confirm(
        `Move this tenant to the "${newTier.name}" tier? This changes their feature access + quotas immediately. The action is recorded in the tenant's audit log.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await changeTenantTierAction({
        organizationId,
        tierId: selected,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Tier changed to ${newTier.name}. Refresh the page to see the new effective quotas.`,
      );
      router.refresh();
    });
  }

  return (
    <form className="mt-3 flex flex-col gap-2" onSubmit={onSubmit}>
      <label className="aur-label">Change tier</label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="aur-input flex-1 min-w-[200px]"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={pending}
        >
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.priceMonthlyCents > 0
                ? ` — $${(t.priceMonthlyCents / 100).toFixed(0)}/mo`
                : ""}
              {t.id === currentTierId ? " (current)" : ""}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          disabled={pending || selected === currentTierId}
        >
          {pending ? "Updating…" : "Change tier"}
        </button>
      </div>

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

      <p className="font-mono text-[10px] leading-relaxed text-muted/80">
        Audited as <code>tenant.tier_change</code> in the target tenant&apos;s
        audit log. Tenant admins see the change in their own /audit-log.
        Retired tiers (active=false) are filtered out of the dropdown.
      </p>
    </form>
  );
}
