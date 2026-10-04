import { Panel } from "@/components/ui/Panel";
import { listAddonCatalog, listTenantAddons } from "@/lib/addons";
import { ADDON_FLAG_LABELS, formatTokenCount } from "@/lib/addons-logic";
import type { CurrentTier } from "@/lib/subscription-gates";
import { TenantAddonsPanel } from "./TenantAddonsPanel";

/**
 * BL-PACKAGES add-ons Slice 1 — the tenant's add-ons on /admin/orgs/[id].
 * Rendered by the page under requireSuperadmin(); every read is scoped
 * to the tenant whose page this is.
 */
export async function TenantAddonsSection({ organizationId, currentTier }: { organizationId: string; currentTier: CurrentTier | null }) {
  const [grants, catalog] = await Promise.all([listTenantAddons({ organizationId }), listAddonCatalog({ activeOnly: true })]);
  const live = grants.filter((g) => g.live).length;
  const addons = currentTier?.addons;
  return (
    <Panel title="Add-ons" eyebrow={live > 0 ? `${live} live` : "None live"}>
      {addons && (addons.extraTokens > 0 || addons.unlockedFlags.length > 0) ? (
        <p className="mb-3 font-mono text-[11px] text-muted">
          Counting now:{" "}
          {addons.extraTokens > 0 ? <span className="text-text">+{formatTokenCount(addons.extraTokens)} AI tokens / month</span> : null}
          {addons.extraTokens > 0 && addons.unlockedFlags.length > 0 ? " · " : null}
          {addons.unlockedFlags.length > 0 ? <span className="text-text">unlocks {addons.unlockedFlags.map((f) => ADDON_FLAG_LABELS[f]).join(", ")}</span> : null}
        </p>
      ) : null}
      <TenantAddonsPanel organizationId={organizationId} grants={grants} catalog={catalog} />
    </Panel>
  );
}
