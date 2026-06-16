import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  subscriptionTiers,
  type TierFeatureFlags,
  type TierQuotas,
} from "@/db/schema";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * BL-PACKAGES Slice 4 — public pricing page.
 *
 * Anyone can browse the subscription tiers we offer. Each card renders
 * the tier's name + tagline, price (monthly + yearly), included
 * features, and quota allowances. CTA routes to /sign-up with the
 * tier pre-selected (signup flow reads ?tier= to remember the intent).
 *
 * Source-of-truth: `subscription_tier` rows configured by superadmin
 * via `/admin/tiers`. Toggling `active=false` on a tier removes it
 * from this page immediately — no separate marketing flag needed.
 *
 * Cross-tenant access posture: this is intentionally PUBLIC (no auth
 * gate, no organizationId scope) because subscription tiers are a
 * platform catalogue, not tenant data. Auth-config whitelists this
 * route in `authConfig.callbacks.authorized`.
 */

const FEATURE_LABELS: Record<keyof TierFeatureFlags, string> = {
  aiAutoDraft: "AI auto-draft for proposal sections",
  winnerAnalysis: "Winner analysis (lost-bid debriefs)",
  complianceMatrix: "Compliance matrix preflight",
  bulkExport: "Bulk export (CSV / Excel)",
  apiAccess: "Public API access",
  customTemplates: "Custom proposal templates",
};

const QUOTA_LABELS: Record<keyof TierQuotas, string> = {
  aiRequestsPerMonth: "AI requests / month",
  aiTokensPerMonth: "AI tokens / month",
  seatsIncluded: "Seats included",
  storageGb: "Storage (GB)",
  proposalsPerMonth: "Proposals / month",
};

function formatPrice(cents: number, cadence: "mo" | "yr"): string {
  if (cents === 0) return "Free";
  // Whole dollars for clean display; tiers with cents will round.
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString()}/${cadence}`;
}

function formatQuota(key: keyof TierQuotas, value: number): string {
  if (value === 0) return "Unlimited";
  if (key === "aiTokensPerMonth" && value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return value.toLocaleString();
}

export default async function PricingPage() {
  const session = await auth();
  const signedIn = !!session?.user;

  const tiers = await db
    .select({
      id: subscriptionTiers.id,
      slug: subscriptionTiers.slug,
      name: subscriptionTiers.name,
      description: subscriptionTiers.description,
      priceMonthlyCents: subscriptionTiers.priceMonthlyCents,
      priceYearlyCents: subscriptionTiers.priceYearlyCents,
      featureFlags: subscriptionTiers.featureFlags,
      quotas: subscriptionTiers.quotas,
      sortOrder: subscriptionTiers.sortOrder,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.active, true))
    .orderBy(asc(subscriptionTiers.sortOrder));

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 md:py-20">
      <div className="text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-teal">
          FORGE pricing
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-text md:text-4xl">
          One platform for the proposal lifecycle.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-balance font-body text-[15px] leading-relaxed text-muted">
          Capture, compliance, drafting, review, and submission — built for
          federal and commercial procurement teams. Pick the plan that fits
          your pursuit volume; upgrade any time as deals land.
        </p>
      </div>

      {tiers.length === 0 ? (
        <div className="mt-16 text-center font-body text-[14px] text-muted">
          Pricing tiers are being configured. Check back shortly or{" "}
          <Link href="/sign-up" className="text-teal hover:underline">
            create an account
          </Link>{" "}
          to start with the default plan.
        </div>
      ) : (
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tiers.map((tier) => {
            const flags = tier.featureFlags as TierFeatureFlags;
            const quotas = tier.quotas as TierQuotas;
            const enabled = (Object.keys(flags) as (keyof TierFeatureFlags)[])
              .filter((k) => flags[k]);
            const upgradeHref = signedIn
              ? `/settings?upgrade=${tier.slug}`
              : `/sign-up?tier=${tier.slug}`;
            return (
              <div
                key={tier.id}
                className="aur-card-elevated relative flex flex-col overflow-hidden p-6"
              >
                <div
                  className="absolute inset-x-0 top-0 h-[2px]"
                  style={{
                    background:
                      "linear-gradient(90deg, #2DD4BF, #34D399 55%, #EC4899)",
                  }}
                />
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
                  {tier.slug}
                </div>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-text">
                  {tier.name}
                </h2>
                {tier.description ? (
                  <p className="mt-2 min-h-[3rem] font-body text-[13px] leading-relaxed text-muted">
                    {tier.description}
                  </p>
                ) : (
                  <p className="mt-2 min-h-[3rem] font-body text-[13px] leading-relaxed text-muted">
                    &nbsp;
                  </p>
                )}

                <div className="mt-5">
                  <div className="font-display text-2xl font-semibold tracking-tight text-text">
                    {formatPrice(tier.priceMonthlyCents, "mo")}
                  </div>
                  {tier.priceYearlyCents > 0 &&
                  tier.priceYearlyCents < tier.priceMonthlyCents * 12 ? (
                    <div className="mt-1 font-mono text-[11px] text-muted">
                      or {formatPrice(tier.priceYearlyCents, "yr")} (save{" "}
                      {Math.round(
                        100 -
                          (tier.priceYearlyCents /
                            (tier.priceMonthlyCents * 12)) *
                            100,
                      )}
                      %)
                    </div>
                  ) : tier.priceYearlyCents > 0 ? (
                    <div className="mt-1 font-mono text-[11px] text-muted">
                      or {formatPrice(tier.priceYearlyCents, "yr")}
                    </div>
                  ) : null}
                </div>

                <ul className="mt-6 flex flex-col gap-2">
                  {(Object.keys(QUOTA_LABELS) as (keyof TierQuotas)[]).map(
                    (k) => (
                      <li
                        key={k}
                        className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 font-mono text-[11px]"
                      >
                        <span className="text-muted">{QUOTA_LABELS[k]}</span>
                        <span className="font-semibold text-text">
                          {formatQuota(k, quotas[k] ?? 0)}
                        </span>
                      </li>
                    ),
                  )}
                </ul>

                {enabled.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-1.5">
                    {enabled.map((k) => (
                      <li
                        key={k}
                        className="flex items-start gap-2 font-body text-[12.5px] leading-relaxed text-text/90"
                      >
                        <span aria-hidden className="mt-0.5 text-emerald-400">
                          ✓
                        </span>
                        <span>{FEATURE_LABELS[k]}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-auto pt-6">
                  <Link
                    href={upgradeHref}
                    className="aur-btn aur-btn-primary w-full justify-center text-[12px]"
                  >
                    {signedIn ? "Upgrade" : "Get started"} →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-16 text-center">
        <p className="font-body text-[13px] text-muted">
          Need an enterprise plan, FedRAMP/CMMC-aligned hosting, or volume
          pricing for an agency procurement program?
        </p>
        <p className="mt-2 font-body text-[14px] text-text">
          Email{" "}
          <a href="mailto:sales@sysgov.com" className="text-teal hover:underline">
            sales@sysgov.com
          </a>{" "}
          and we&apos;ll route you to a human.
        </p>
      </div>
    </div>
  );
}
