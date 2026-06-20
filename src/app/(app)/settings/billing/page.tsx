import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import {
  subscriptionTiers,
  tenantSubscriptions,
  type TierFeatureFlags,
  type TierQuotas,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { BillingActionsClient } from "./BillingActionsClient";

export const dynamic = "force-dynamic";

/**
 * BL-17 Slice 3 — tenant-facing billing page.
 *
 * Server component renders:
 *   - Current subscription summary (tier, status, period end)
 *   - Available tiers grouped into "Upgrade" vs "Downgrade" cards
 *   - "Subscribe / upgrade" CTA per tier that triggers the
 *     createCheckoutSessionAction → Stripe Checkout → return
 *
 * Status banners:
 *   - ?checkout=success → "Welcome to <tier>! Provisioning in progress."
 *     (the webhook from Slice 2 finalizes the binding within ~1-2 sec)
 *   - ?checkout=cancelled → "Checkout cancelled, no charge made."
 *
 * Access: any signed-in member; the action itself gates on
 * `requireOrgAdmin` so non-admins see the prices but can't initiate
 * checkout. (Future: hide CTAs for non-admins entirely — cosmetic.)
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: { checkout?: string; session_id?: string };
}) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Resolve current subscription + tier metadata.
  const [current] = await db
    .select({
      tierId: tenantSubscriptions.tierId,
      tierSlug: subscriptionTiers.slug,
      tierName: subscriptionTiers.name,
      status: tenantSubscriptions.status,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      cancelAt: tenantSubscriptions.cancelAt,
      hasStripeCustomer: tenantSubscriptions.stripeCustomerId,
    })
    .from(tenantSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, tenantSubscriptions.tierId),
    )
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);

  // All buyable tiers (active + at least one Stripe price configured).
  const tiers = await db
    .select({
      id: subscriptionTiers.id,
      slug: subscriptionTiers.slug,
      name: subscriptionTiers.name,
      description: subscriptionTiers.description,
      priceMonthlyCents: subscriptionTiers.priceMonthlyCents,
      priceYearlyCents: subscriptionTiers.priceYearlyCents,
      stripePriceIdMonthly: subscriptionTiers.stripePriceIdMonthly,
      stripePriceIdYearly: subscriptionTiers.stripePriceIdYearly,
      featureFlags: subscriptionTiers.featureFlags,
      quotas: subscriptionTiers.quotas,
      sortOrder: subscriptionTiers.sortOrder,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.active, true))
    .orderBy(asc(subscriptionTiers.sortOrder));

  const checkoutFlash = readFlash(searchParams);
  const isAdmin = user.role === "admin" || user.isSuperadmin;

  return (
    <>
      <PageHeader
        eyebrow="Account · Billing"
        title="Billing &amp; subscription"
        subtitle="Manage your FORGE plan. Upgrades take effect immediately; downgrades and cancellations apply at the end of the current period."
        actions={
          <Link href="/pricing" className="aur-btn aur-btn-ghost text-[11px]">
            See all plans →
          </Link>
        }
      />

      {checkoutFlash ? (
        <div
          className={`mt-4 rounded-md border px-3 py-2 font-mono text-[11px] ${
            checkoutFlash.tone === "ok"
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              : "border-amber-400/40 bg-amber-400/[0.06] text-amber-200"
          }`}
        >
          {checkoutFlash.message}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_2fr]">
        <Panel title="Current plan" eyebrow="Live status">
          <div className="font-display text-xl font-semibold text-text">
            {current?.tierName || "(no plan)"}
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            {current?.status || "—"}
          </div>
          {current?.currentPeriodEnd ? (
            <div className="mt-3 font-body text-[12.5px] text-muted">
              Renews on{" "}
              <span className="text-text">
                {new Date(current.currentPeriodEnd).toLocaleDateString(
                  "en-US",
                  { dateStyle: "medium" },
                )}
              </span>
            </div>
          ) : null}
          {current?.cancelAt ? (
            <div className="mt-1 font-body text-[12.5px] text-amber-200">
              Cancels on{" "}
              {new Date(current.cancelAt).toLocaleDateString("en-US", {
                dateStyle: "medium",
              })}
            </div>
          ) : null}
          {!isAdmin ? (
            <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[10px] text-muted">
              Only org admins can change the plan. Ask your admin to upgrade.
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Available plans"
          eyebrow={`${tiers.length} plan${tiers.length === 1 ? "" : "s"}`}
        >
          {tiers.length === 0 ? (
            <p className="font-body text-[13px] text-muted">
              No plans are currently available. Contact support.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {tiers.map((t) => {
                const flags = t.featureFlags as TierFeatureFlags;
                const quotas = t.quotas as TierQuotas;
                const enabled = (Object.keys(flags) as (keyof TierFeatureFlags)[])
                  .filter((k) => flags[k]);
                const isCurrent = current?.tierId === t.id;
                const canBuy =
                  !!t.stripePriceIdMonthly || !!t.stripePriceIdYearly;
                return (
                  <div
                    key={t.id}
                    className={`rounded-lg border p-4 ${
                      isCurrent
                        ? "border-teal/40 bg-teal/[0.04]"
                        : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <div className="font-display text-[15px] font-semibold text-text">
                          {t.name}
                          {isCurrent ? (
                            <span className="ml-2 rounded border border-teal/40 bg-teal/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-teal">
                              Current
                            </span>
                          ) : null}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                          {t.slug}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-[14px] text-text">
                          {priceLabel(t.priceMonthlyCents, "mo")}
                        </div>
                        {t.priceYearlyCents > 0 ? (
                          <div className="font-mono text-[10px] text-muted">
                            or {priceLabel(t.priceYearlyCents, "yr")}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {t.description ? (
                      <p className="mt-2 font-body text-[12.5px] leading-relaxed text-muted">
                        {t.description}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-3 font-mono text-[10px] text-muted">
                      <span>
                        AI tokens:{" "}
                        <span className="text-text">
                          {formatQuota(quotas.aiTokensPerMonth ?? 0)}
                        </span>
                      </span>
                      <span>
                        Seats:{" "}
                        <span className="text-text">
                          {formatQuota(quotas.seatsIncluded ?? 0)}
                        </span>
                      </span>
                      <span>
                        Storage:{" "}
                        <span className="text-text">
                          {quotas.storageGb === 0
                            ? "Unlimited"
                            : `${quotas.storageGb} GB`}
                        </span>
                      </span>
                      {enabled.length > 0 ? (
                        <span>
                          Features:{" "}
                          <span className="text-text">
                            {enabled.length} included
                          </span>
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {isCurrent ? (
                        <span className="font-mono text-[10px] text-muted">
                          You're on this plan.
                        </span>
                      ) : canBuy && isAdmin ? (
                        <BillingActionsClient
                          tierSlug={t.slug}
                          tierName={t.name}
                          monthlyAvailable={!!t.stripePriceIdMonthly}
                          yearlyAvailable={!!t.stripePriceIdYearly}
                          isUpgrade={(current?.tierId ?? "") !== t.id}
                        />
                      ) : !canBuy ? (
                        <a
                          href="mailto:sales@sysgov.com"
                          className="aur-btn aur-btn-ghost text-[11px]"
                        >
                          Contact sales →
                        </a>
                      ) : (
                        <span className="font-mono text-[10px] text-muted">
                          Admin-only
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function readFlash(
  searchParams: { checkout?: string; session_id?: string },
): { tone: "ok" | "info"; message: string } | null {
  if (searchParams.checkout === "success") {
    return {
      tone: "ok",
      message:
        "Checkout complete — your plan will activate within a few seconds.",
    };
  }
  if (searchParams.checkout === "cancelled") {
    return {
      tone: "info",
      message: "Checkout cancelled. No charge was made.",
    };
  }
  return null;
}

function priceLabel(cents: number, cadence: "mo" | "yr"): string {
  if (cents === 0) return "Free";
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString()}/${cadence}`;
}

function formatQuota(value: number): string {
  if (value === 0) return "Unlimited";
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toLocaleString();
}
