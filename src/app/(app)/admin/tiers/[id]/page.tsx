import { count, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { TierEditForm } from "./TierEditForm";

export const dynamic = "force-dynamic";

/**
 * BL-16 Phase C-3 — tier editor page. Superadmin-only.
 *
 * Lets superadmins mutate every field on a `subscription_tier` row
 * except `slug` (kept stable for external-reference compatibility)
 * and `created_at`. `active=false` is gated server-side on
 * tenant-count = 0.
 */
export default async function TierEditPage({
  params,
}: {
  params: { id: string };
}) {
  await requireSuperadmin();

  const [tier] = await db
    .select()
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.id, params.id))
    .limit(1);

  if (!tier) notFound();

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tierId, params.id));

  const tenantCount = Number(n);

  return (
    <>
      <PageHeader
        eyebrow={`Subscription tier · ${tier.slug}`}
        title={`Edit: ${tier.name}`}
        subtitle="All fields except slug are editable. Slug is preserved for external integrations + seed-data references."
        actions={
          <Link
            href="/admin/tiers"
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            ← All tiers
          </Link>
        }
        meta={[
          {
            label: "Status",
            value: tier.active ? "Active" : "Retired",
            accent: tier.active ? "emerald" : "rose",
          },
          { label: "Tenants on this tier", value: String(tenantCount) },
          { label: "Sort order", value: String(tier.sortOrder) },
        ]}
      />

      <Panel title="Tier details">
        <TierEditForm
          tierId={tier.id}
          tierSlug={tier.slug}
          tenantCount={tenantCount}
          initial={{
            name: tier.name,
            description: tier.description,
            priceMonthlyCents: tier.priceMonthlyCents,
            priceYearlyCents: tier.priceYearlyCents,
            featureFlags: tier.featureFlags as TierFeatureFlags,
            quotas: tier.quotas as TierQuotas,
            sortOrder: tier.sortOrder,
            active: tier.active,
          }}
        />
      </Panel>
    </>
  );
}
