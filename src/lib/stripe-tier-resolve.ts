import "server-only";

import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { subscriptionTiers } from "@/db/schema";

/**
 * BL-17 Slice 4 — resolve a FORGE tier from a Stripe Price id.
 *
 * The Stripe webhook handlers don't know which FORGE tier the
 * subscription represents until they reverse-look up the Price id
 * (which Stripe puts on the line items) against the
 * `subscription_tier.stripe_price_id_monthly` / `_yearly` columns
 * super-admin pasted in via /admin/tiers/[id].
 *
 * Returns the tier metadata when found, null otherwise. A null result
 * means "we received an event for a Stripe Price we don't have on
 * file" — could be a Price that was created in Stripe Dashboard but
 * never wired into FORGE. The caller logs + leaves the existing
 * tier_id alone (better than nulling it out, which would deny the
 * tenant every feature on next request).
 */
export async function resolveTierFromStripePriceId(
  stripePriceId: string,
): Promise<{
  tierId: string;
  tierSlug: string;
  tierName: string;
  period: "monthly" | "yearly";
} | null> {
  if (!stripePriceId) return null;
  const [row] = await db
    .select({
      id: subscriptionTiers.id,
      slug: subscriptionTiers.slug,
      name: subscriptionTiers.name,
      monthly: subscriptionTiers.stripePriceIdMonthly,
      yearly: subscriptionTiers.stripePriceIdYearly,
    })
    .from(subscriptionTiers)
    .where(
      or(
        eq(subscriptionTiers.stripePriceIdMonthly, stripePriceId),
        eq(subscriptionTiers.stripePriceIdYearly, stripePriceId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    tierId: row.id,
    tierSlug: row.slug,
    tierName: row.name,
    period: row.monthly === stripePriceId ? "monthly" : "yearly",
  };
}
