import { Panel } from "@/components/ui/Panel";
import { listAddonCatalog, listTenantAddons } from "@/lib/addons";
import { ADDON_FLAG_LABELS, addonStacks, describeAddon, formatMonthlyPrice, formatTokenCount } from "@/lib/addons-logic";
import type { CurrentTier } from "@/lib/subscription-gates";
import { AddonCheckoutButton } from "./AddonCheckoutButton";
import { AddonGrantControls } from "./AddonGrantControls";

/**
 * BL-PACKAGES add-ons Slice 1 — the tenant-facing picker on
 * /settings/billing: what is on offer, what the organization already
 * holds, and what it does to this month's AI token cap.
 */
export async function AddonsSection({
  organizationId,
  isAdmin,
  tier,
  planSubscriptionId,
}: {
  organizationId: string;
  isAdmin: boolean;
  tier: CurrentTier | null;
  planSubscriptionId: string | null;
}) {
  const [catalog, grants] = await Promise.all([listAddonCatalog({ activeOnly: true }), listTenantAddons({ organizationId })]);
  if (catalog.length === 0 && grants.length === 0) return null;

  const liveByAddon = new Map<string, number>();
  for (const g of grants) if (g.live) liveByAddon.set(g.addonId, (liveByAddon.get(g.addonId) ?? 0) + g.quantity);
  const tierTokens = tier ? tier.quotas.aiTokensPerMonth : 0;
  const extra = tier?.addons.extraTokens ?? 0;
  const capNow = tier?.platformQuotas.aiTokensPerMonth ?? 0;

  return (
    <Panel title="Add-ons" eyebrow="À la carte" className="mt-4">
      {tier ? (
        <p className="mb-3 font-mono text-[11px] text-muted">
          AI token cap this month:{" "}
          {capNow === 0 ? (
            <span className="text-text">Unlimited on {tier.tierName}</span>
          ) : (
            <>
              <span className="text-text">{formatTokenCount(capNow)}</span>
              {extra > 0 ? (
                <>
                  {" "}
                  ({formatTokenCount(tierTokens)} from {tier.tierName} + {formatTokenCount(extra)} from add-ons)
                </>
              ) : null}
            </>
          )}
          {tier.addons.extraSeats > 0 ? <> · +{tier.addons.extraSeats.toLocaleString()} seats from add-ons</> : null}
          {tier.addons.extraStorageGb > 0 ? <> · +{tier.addons.extraStorageGb.toLocaleString()} GB storage from add-ons</> : null}
          {tier.addons.unlockedFlags.length > 0 ? <> · add-ons unlock {tier.addons.unlockedFlags.map((f) => ADDON_FLAG_LABELS[f]).join(", ")}</> : null}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {catalog.map((a) => {
          const held = liveByAddon.get(a.id) ?? 0;
          const stackable = addonStacks(a.kind);
          const bought = grants.filter((g) => g.live && g.addonId === a.id && g.source === "stripe" && g.status === "active");
          return (
            <div key={a.id} className={`rounded-lg border p-4 ${held > 0 ? "border-teal/40 bg-teal/[0.04]" : "border-layer/10 bg-layer/[0.02]"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <div className="font-display text-[14px] font-semibold text-text">
                    {a.name}
                    {held > 0 ? (
                      <span className="ml-2 rounded border border-teal/40 bg-teal/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-teal">
                        Active{held > 1 ? ` ×${held}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{describeAddon(a)}</div>
                </div>
                <div className="font-display text-[14px] text-text">{formatMonthlyPrice(a.priceMonthlyCents)}</div>
              </div>
              {a.description ? <p className="mt-2 font-body text-[12.5px] leading-relaxed text-muted">{a.description}</p> : null}
              {isAdmin && bought.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {bought.map((g) => {
                    const onPlan = !!g.stripeSubscriptionItemId && g.stripeSubscriptionId === planSubscriptionId;
                    return (
                      <div key={g.id} className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                          {onPlan ? "On your plan's invoice" : "Own subscription"}
                          {g.endsAt ? ` · ends ${g.endsAt.slice(0, 10)}` : ""}
                        </span>
                        <AddonGrantControls tenantAddonId={g.id} name={a.name} quantity={g.quantity} stackable={stackable} onPlan={onPlan} />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {held > 0 && !stackable ? (
                  <span className="font-mono text-[10px] text-muted">You have this add-on.</span>
                ) : a.stripePriceId && isAdmin ? (
                  <AddonCheckoutButton addonSlug={a.slug} addonName={a.name} stackable={stackable} />
                ) : !a.stripePriceId ? (
                  <a href="mailto:sales@sysgov.com" className="aur-btn aur-btn-ghost text-[11px]">
                    Contact sales →
                  </a>
                ) : (
                  <span className="font-mono text-[10px] text-muted">Admin-only</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 font-mono text-[10px] text-muted">
        {planSubscriptionId
          ? "Add-ons you buy here go on your plan's invoice when they renew on the same interval; adding, changing or removing one is prorated for the rest of the period."
          : "Add-ons bought by card renew monthly; once you pay for a plan by card, new add-ons go on its invoice."}
      </p>
    </Panel>
  );
}
