"use server";

import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  subscriptionTiers,
  tenantSubscriptions,
  type TierFeatureFlags,
  type TierQuotas,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

/**
 * BL-16 Phase C-3 — edit a `subscription_tier` row.
 *
 * Superadmin-only. Validates input via zod, refuses retiring
 * (`active=false`) a tier with active subscriptions (the FK is
 * `ON DELETE RESTRICT` so retired-but-referenced data would be
 * inconsistent), audits the change.
 *
 * Doesn't allow renaming the `slug` — slugs are referenced from seed
 * data and (eventually) external billing integrations; renaming would
 * silently break those references. Create a new tier if you need a
 * different slug.
 */

const TierFeatureFlagsSchema = z.object({
  aiAutoDraft: z.boolean(),
  winnerAnalysis: z.boolean(),
  complianceMatrix: z.boolean(),
  bulkExport: z.boolean(),
  apiAccess: z.boolean(),
  customTemplates: z.boolean(),
}) satisfies z.ZodType<TierFeatureFlags>;

const TierQuotasSchema = z.object({
  aiRequestsPerMonth: z.number().int().min(0),
  aiTokensPerMonth: z.number().int().min(0),
  seatsIncluded: z.number().int().min(0),
  storageGb: z.number().int().min(0),
  proposalsPerMonth: z.number().int().min(0),
}) satisfies z.ZodType<TierQuotas>;

const UpdateTierInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(64),
  description: z.string().trim().max(500).default(""),
  priceMonthlyCents: z
    .number()
    .int("Price must be a whole number of cents.")
    .min(0),
  priceYearlyCents: z
    .number()
    .int("Price must be a whole number of cents.")
    .min(0),
  featureFlags: TierFeatureFlagsSchema,
  quotas: TierQuotasSchema,
  sortOrder: z.number().int(),
  active: z.boolean(),
});

export type UpdateTierInput = z.infer<typeof UpdateTierInputSchema>;

export async function updateTierAction(
  tierId: string,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  const parsed = UpdateTierInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first
        ? `${first.path.join(".")}: ${first.message}`
        : "Invalid input.",
    };
  }
  const input = parsed.data;

  const [existing] = await db
    .select({
      id: subscriptionTiers.id,
      slug: subscriptionTiers.slug,
      name: subscriptionTiers.name,
      active: subscriptionTiers.active,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.id, tierId))
    .limit(1);

  if (!existing) {
    return { ok: false, error: "Tier not found." };
  }

  // Refuse retiring a tier that has tenants on it. Forces an explicit
  // "reassign first" workflow instead of silently breaking AI / quota
  // resolution for those tenants (getCurrentTier denies all features
  // on a retired tier).
  if (existing.active && !input.active) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tierId, tierId));
    if (Number(n) > 0) {
      return {
        ok: false,
        error: `Cannot retire "${existing.name}" — ${n} tenant(s) are on it. Move them to a different tier first.`,
      };
    }
  }

  try {
    await db
      .update(subscriptionTiers)
      .set({
        name: input.name,
        description: input.description,
        priceMonthlyCents: input.priceMonthlyCents,
        priceYearlyCents: input.priceYearlyCents,
        featureFlags: input.featureFlags,
        quotas: input.quotas,
        sortOrder: input.sortOrder,
        active: input.active,
        updatedAt: new Date(),
      })
      .where(eq(subscriptionTiers.id, tierId));

    // Tier edits are platform-scoped (no specific tenant). When the
    // acting superadmin has a primary org we record the audit row
    // against it so the action shows up in their org's /audit-log.
    // Pure-superadmins without an org get a structured log line
    // instead of a DB row — tier edits are rare and we can find
    // them via grep on the deploy logs if needed. A platform-wide
    // audit table is queued separately.
    if (actor.organizationId) {
      await recordAudit({
        organizationId: actor.organizationId,
        actor: { userId: actor.id, email: actor.email },
        action: "subscription_tier.update",
        resourceType: "subscription_tier",
        resourceId: tierId,
        metadata: {
          slug: existing.slug,
          name: input.name,
          priceMonthlyCents: input.priceMonthlyCents,
          priceYearlyCents: input.priceYearlyCents,
          featureFlags: input.featureFlags,
          quotas: input.quotas,
          active: input.active,
        },
      });
    } else {
      log.info("[updateTierAction]", "tier update by pure superadmin", {
        actorUserId: actor.id,
        actorEmail: actor.email,
        tierId,
        tierSlug: existing.slug,
      });
    }

    revalidatePath("/admin/tiers");
    revalidatePath(`/admin/tiers/${tierId}`);
    return { ok: true };
  } catch (err) {
    log.error("[updateTierAction]", "update failed", {
      error: err,
      tierId,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}
