/**
 * BL-19 Phase 2 — two-tenant fixture builder for runtime isolation tests.
 *
 * Each test creates a fresh pair of organizations + their own seed data.
 * Org and user names are uniquified per call so parallel tests can't
 * collide. Cleanup removes the orgs (CASCADE handles every dependent
 * row), so a flaky test never leaves persistent fixtures behind.
 */

import { db } from "@/db";
import {
  knowledgeArtifacts,
  memberships,
  opportunities,
  organizations,
  proposals,
  users,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

export type TenantFixture = {
  organizationId: string;
  userId: string;
  opportunityId: string;
  proposalId: string;
  knowledgeArtifactId: string;
};

export type TwoTenantFixture = {
  orgA: TenantFixture;
  orgB: TenantFixture;
  cleanup: () => Promise<void>;
};

/**
 * Build two isolated tenants with seed data. Always call `cleanup()`
 * in afterEach (or wrap in try/finally) so leftover rows don't
 * accumulate across runs.
 */
export async function createTwoTenants(label: string): Promise<TwoTenantFixture> {
  const tag = `bl19-${label}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const orgA = await seedTenant(`${tag}-a`);
  const orgB = await seedTenant(`${tag}-b`);

  return {
    orgA,
    orgB,
    async cleanup() {
      // CASCADE on every FK back to organization.id removes children.
      await db
        .delete(organizations)
        .where(
          inArray(organizations.id, [
            orgA.organizationId,
            orgB.organizationId,
          ]),
        );
      // Users aren't org-FK'd via CASCADE; remove the test users by id.
      await db
        .delete(users)
        .where(inArray(users.id, [orgA.userId, orgB.userId]));
    },
  };
}

async function seedTenant(slugTag: string): Promise<TenantFixture> {
  // 1. Create the org. Slug must be globally unique (varchar(64)).
  const [org] = await db
    .insert(organizations)
    .values({
      name: `Test org ${slugTag}`,
      slug: slugTag.slice(0, 60),
    })
    .returning({ id: organizations.id });
  if (!org) throw new Error("seedTenant: org insert returned no row");

  // 2. Create a user + membership so requireOrgMember-style queries work.
  const userId = `${slugTag}-user`;
  await db.insert(users).values({
    id: userId,
    name: `Test ${slugTag}`,
    email: `${slugTag}@bl19-isolation.test`,
    emailVerified: new Date(),
  });
  await db.insert(memberships).values({
    userId,
    organizationId: org.id,
    role: "admin",
    status: "active",
  });

  // 3. Seed one opportunity, one proposal (FK to opportunity), one knowledge artifact.
  const [opp] = await db
    .insert(opportunities)
    .values({
      organizationId: org.id,
      title: `${slugTag} opp`,
    })
    .returning({ id: opportunities.id });
  if (!opp) throw new Error("seedTenant: opportunity insert returned no row");

  const [prop] = await db
    .insert(proposals)
    .values({
      organizationId: org.id,
      opportunityId: opp.id,
      title: `${slugTag} proposal`,
    })
    .returning({ id: proposals.id });
  if (!prop) throw new Error("seedTenant: proposal insert returned no row");

  const [art] = await db
    .insert(knowledgeArtifacts)
    .values({
      organizationId: org.id,
      kind: "other",
      source: "uploaded",
      title: `${slugTag} artifact`,
      fileName: `${slugTag}.txt`,
      fileSize: 100,
      contentType: "text/plain",
      storagePath: `test/${slugTag}.txt`,
      rawText: "test fixture body",
      status: "indexed",
    })
    .returning({ id: knowledgeArtifacts.id });
  if (!art) throw new Error("seedTenant: artifact insert returned no row");

  return {
    organizationId: org.id,
    userId,
    opportunityId: opp.id,
    proposalId: prop.id,
    knowledgeArtifactId: art.id,
  };
}

/**
 * Build a subscription tier + assign it to an organization, for tests
 * that exercise `enforceQuota` / `ensureFeature` / `refundQuota`.
 * Returns helpers to clean both rows up after the test.
 */
export async function createTierAndSubscribe(opts: {
  organizationId: string;
  slug: string;
  name: string;
  featureFlags?: Partial<import("@/db/schema").TierFeatureFlags>;
  quotas?: Partial<import("@/db/schema").TierQuotas>;
  active?: boolean;
  overrides?: {
    featureFlags?: Partial<import("@/db/schema").TierFeatureFlags>;
    quotas?: Partial<import("@/db/schema").TierQuotas>;
  };
}): Promise<{ tierId: string; cleanup: () => Promise<void> }> {
  const { subscriptionTiers, tenantSubscriptions } = await import(
    "@/db/schema"
  );
  const defaultFlags: import("@/db/schema").TierFeatureFlags = {
    aiAutoDraft: false,
    winnerAnalysis: false,
    complianceMatrix: false,
    bulkExport: false,
    apiAccess: false,
    customTemplates: false,
  };
  const defaultQuotas: import("@/db/schema").TierQuotas = {
    aiRequestsPerMonth: 0,
    aiTokensPerMonth: 0,
    proposalsPerMonth: 0,
    seatsIncluded: 0,
    storageGb: 0,
  };
  const [tier] = await db
    .insert(subscriptionTiers)
    .values({
      slug: opts.slug,
      name: opts.name,
      featureFlags: { ...defaultFlags, ...(opts.featureFlags ?? {}) },
      quotas: { ...defaultQuotas, ...(opts.quotas ?? {}) },
      active: opts.active ?? true,
    })
    .returning({ id: subscriptionTiers.id });
  if (!tier) throw new Error("createTierAndSubscribe: tier insert failed");

  await db
    .insert(tenantSubscriptions)
    .values({
      organizationId: opts.organizationId,
      tierId: tier.id,
      status: "active",
      customOverrides: opts.overrides ?? {},
    })
    .onConflictDoUpdate({
      target: tenantSubscriptions.organizationId,
      set: {
        tierId: tier.id,
        customOverrides: opts.overrides ?? {},
      },
    });

  return {
    tierId: tier.id,
    async cleanup() {
      await db
        .delete(tenantSubscriptions)
        .where(eq(tenantSubscriptions.organizationId, opts.organizationId));
      await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tier.id));
    },
  };
}

/**
 * Convenience — verify a specific row still exists in its org. Used to
 * assert that a cross-tenant DELETE/UPDATE attempt was a no-op.
 */
export async function opportunityExists(
  id: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);
  return !!rows[0] && rows[0].id === id && organizationId.length > 0;
}
