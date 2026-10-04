import { count, eq } from "drizzle-orm";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import { tenantAddons } from "@/db/schema";
import { listAddonCatalog } from "@/lib/addons";
import { AddonCatalogPanel } from "./AddonCatalogPanel";

/**
 * BL-PACKAGES add-ons Slice 1 — the catalogue on /admin/tiers, with how
 * many tenants hold each add-on. Rendered under requireSuperadmin() by
 * the page; cross-tenant by design (platform billing surface).
 */
export async function AddonCatalogSection() {
  const [addons, grantRows] = await Promise.all([
    listAddonCatalog(),
    db
      .select({ addonId: tenantAddons.addonId, n: count() })
      .from(tenantAddons)
      .where(eq(tenantAddons.status, "active"))
      .groupBy(tenantAddons.addonId),
  ]);
  const activeGrants: Record<string, number> = {};
  for (const r of grantRows) activeGrants[r.addonId] = Number(r.n);

  return (
    <Panel
      title="À la carte add-ons"
      eyebrow={`${addons.filter((a) => a.active).length} on offer`}
      className="mt-4"
    >
      <p className="mb-3 font-body text-[12px] leading-relaxed text-muted">
        Sold on top of any tier. A <strong>token top-up</strong> raises the tenant&apos;s monthly AI token cap by its amount per unit (a tier with an unlimited cap gains nothing); a <strong>feature unlock</strong> turns one feature on. Tenants buy add-ons with a Stripe Price on <code>/settings/billing</code>; you can grant any add-on by hand on a tenant&apos;s page under <code>/admin/orgs</code>.
      </p>
      <AddonCatalogPanel addons={addons} activeGrants={activeGrants} />
    </Panel>
  );
}
