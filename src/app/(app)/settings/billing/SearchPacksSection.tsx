import { Panel } from "@/components/ui/Panel";
import { formatPackPrice } from "@/lib/search-pack-logic";
import { getSearchCreditBalance, listActiveSearchPacks } from "@/lib/search-credits";
import type { CurrentTier } from "@/lib/subscription-gates";
import { SearchPackButton } from "./SearchPackButton";

/**
 * BL-NAV-LIFECYCLE 5b-2b — prepaid web-search packs on /settings/billing:
 * what the organization holds and what it can buy. A pack is a one-time
 * payment; its searches are used only after the plan's monthly searches
 * and do not expire. Sold to plans that include Auto-draft.
 */
export async function SearchPacksSection({
  organizationId,
  isAdmin,
  tier,
}: {
  organizationId: string;
  isAdmin: boolean;
  tier: CurrentTier | null;
}) {
  const [packs, balance] = await Promise.all([
    listActiveSearchPacks().catch(() => []),
    getSearchCreditBalance(organizationId).catch(() => 0),
  ]);
  if (packs.length === 0 && balance === 0) return null;
  const canResearch = Boolean(tier?.effectiveFlags.aiAutoDraft);

  return (
    <Panel title="Web search packs" eyebrow="Prepaid" className="mt-4">
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        Pack searches held: <span className="text-text">{balance.toLocaleString("en-US")}</span>. FORGE uses your plan&apos;s monthly web searches
        first and a pack only when those are gone. Pack searches do not expire, and research pauses when both are at zero: there is no
        automatic top-up and no overage charge.
      </p>
      {packs.length > 0 ? (
        <ul className="divide-y divide-layer/5 border-t border-layer/10">
          {packs.map((p) => (
            <li key={p.slug} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-display text-[14px] font-semibold text-text">{p.name}</div>
                <div className="font-mono text-[11px] text-muted">
                  {p.searches.toLocaleString("en-US")} searches · {formatPackPrice(p.priceCents, p.currency)} · one-time payment
                </div>
              </div>
              {!canResearch ? (
                <span className="font-mono text-[11px] text-muted">Needs a plan that includes Auto-draft.</span>
              ) : isAdmin ? (
                <SearchPackButton packSlug={p.slug} label={`Buy for ${formatPackPrice(p.priceCents, p.currency)}`} />
              ) : (
                <span className="font-mono text-[11px] text-muted">Ask an org admin to buy.</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
