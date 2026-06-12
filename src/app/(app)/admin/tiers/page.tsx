import { asc, count } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import {
  subscriptionTiers,
  tenantSubscriptions,
  type TierFeatureFlags,
  type TierQuotas,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * BL-16 Phase C-1 — read-only tier list.
 *
 * Lists every `subscription_tier` row with its prices, feature
 * summary, quota summary, and how many tenants are on it today.
 * Superadmin-only. Phase C-2 will add per-tenant assignment;
 * Phase C-3 adds the editor that mutates these rows.
 */
export default async function TiersPage() {
  await requireSuperadmin();

  const tierRows = await db
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
      active: subscriptionTiers.active,
    })
    .from(subscriptionTiers)
    .orderBy(asc(subscriptionTiers.sortOrder));

  // Count tenants per tier. One query, grouped.
  const assignmentRows = await db
    .select({
      tierId: tenantSubscriptions.tierId,
      n: count(),
    })
    .from(tenantSubscriptions)
    .groupBy(tenantSubscriptions.tierId);
  const tenantCountByTier = new Map(
    assignmentRows.map((r) => [r.tierId, Number(r.n)]),
  );

  const totalTenants = assignmentRows.reduce(
    (sum, r) => sum + Number(r.n),
    0,
  );

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Subscription tiers"
        title="Subscription tiers"
        subtitle="Tier defaults (price, features, quotas) and per-tier tenant counts. Editing + per-tenant assignment lands in BL-16 Phase C-2/C-3."
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost text-[11px]">
            ← SuperAdmin portal
          </Link>
        }
        meta={[
          { label: "Tiers", value: String(tierRows.length) },
          {
            label: "Active tiers",
            value: String(tierRows.filter((t) => t.active).length),
            accent: "emerald",
          },
          { label: "Tenants assigned", value: String(totalTenants) },
        ]}
      />

      <Panel title="All tiers">
        {tierRows.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No tiers defined. The default five (Bronze / Silver / Gold /
            Platinum / Custom) should have been seeded by migration 0043.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {tierRows.map((t) => (
              <li
                key={t.id}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <span className="font-display text-base font-semibold text-text">
                      {t.name}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                      {t.slug}
                    </span>
                    {!t.active ? (
                      <span className="rounded bg-rose/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-rose">
                        Retired
                      </span>
                    ) : null}
                  </div>
                  <div className="font-mono text-[11px] text-muted">
                    {formatPrice(t.priceMonthlyCents)}/mo ·{" "}
                    {formatPrice(t.priceYearlyCents)}/yr
                  </div>
                </div>

                {t.description ? (
                  <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-muted">
                    {t.description}
                  </p>
                ) : null}

                <dl className="mt-3 grid grid-cols-1 gap-2 font-mono text-[11px] md:grid-cols-2">
                  <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
                      Features
                    </div>
                    <div className="mt-1 text-text">
                      {summarizeFlags(t.featureFlags as TierFeatureFlags)}
                    </div>
                  </div>
                  <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
                      Quotas
                    </div>
                    <div className="mt-1 text-text">
                      {summarizeQuotas(t.quotas as TierQuotas)}
                    </div>
                  </div>
                </dl>

                <div className="mt-3 flex items-center justify-between font-mono text-[11px]">
                  <span className="text-muted">
                    Tenants on this tier:{" "}
                    <span className="text-text tabular-nums">
                      {tenantCountByTier.get(t.id) ?? 0}
                    </span>
                  </span>
                  <span className="text-muted/70">sort_order {t.sortOrder}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function formatPrice(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toFixed(0)}`;
}

const FLAG_LABELS: Record<keyof TierFeatureFlags, string> = {
  aiAutoDraft: "AI auto-draft",
  winnerAnalysis: "Winner analysis",
  complianceMatrix: "Compliance matrix",
  bulkExport: "Bulk export",
  apiAccess: "API access",
  customTemplates: "Custom templates",
};

function summarizeFlags(flags: TierFeatureFlags): string {
  const enabled = (
    Object.entries(FLAG_LABELS) as Array<[keyof TierFeatureFlags, string]>
  )
    .filter(([key]) => flags[key])
    .map(([, label]) => label);
  if (enabled.length === 0) return "None";
  if (enabled.length === Object.keys(FLAG_LABELS).length) return "All features";
  return enabled.join(", ");
}

function summarizeQuotas(quotas: TierQuotas): string {
  const fmt = (n: number) => (n === 0 ? "Unlimited" : n.toLocaleString());
  return [
    `AI requests/mo: ${fmt(quotas.aiRequestsPerMonth)}`,
    `Seats: ${fmt(quotas.seatsIncluded)}`,
    `Storage: ${fmt(quotas.storageGb)} GB`,
    `Proposals/mo: ${fmt(quotas.proposalsPerMonth)}`,
  ].join(" · ");
}
