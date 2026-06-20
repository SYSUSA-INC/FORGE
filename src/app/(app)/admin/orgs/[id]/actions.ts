"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  memberships,
  organizations,
  subscriptionTiers,
  tenantSubscriptions,
  users,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

/**
 * BL-16 Phase C-2 — change a tenant's subscription tier.
 *
 * Superadmin-only. Updates `tenant_subscription.tier_id` for the
 * target org and writes a `tenant.tier_change` audit row into the
 * target tenant's audit log so the tenant admin sees the change in
 * `/audit-log`.
 *
 * Refuses when:
 *   - The target tier doesn't exist or is `active=false` (retired —
 *     you shouldn't be moving anyone TO a retired tier).
 *   - The target tier is the same as the current one (no-op rejected
 *     for an explicit error message rather than silent success).
 */
export async function changeTenantTierAction(input: {
  organizationId: string;
  tierId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  if (!input.organizationId || !input.tierId) {
    return { ok: false, error: "Pick an organization and a tier." };
  }

  // Validate the target tier exists + is active.
  const [tier] = await db
    .select({
      id: subscriptionTiers.id,
      name: subscriptionTiers.name,
      slug: subscriptionTiers.slug,
      active: subscriptionTiers.active,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.id, input.tierId))
    .limit(1);

  if (!tier) {
    return { ok: false, error: "Target tier not found." };
  }
  if (!tier.active) {
    return {
      ok: false,
      error: `Cannot assign tenants to retired tier "${tier.name}". Pick an active tier.`,
    };
  }

  // Load the current subscription so we can record the from-tier in
  // the audit metadata.
  const [current] = await db
    .select({
      tierId: tenantSubscriptions.tierId,
      tierName: subscriptionTiers.name,
      tierSlug: subscriptionTiers.slug,
    })
    .from(tenantSubscriptions)
    .innerJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, tenantSubscriptions.tierId),
    )
    .where(eq(tenantSubscriptions.organizationId, input.organizationId))
    .limit(1);

  if (!current) {
    return {
      ok: false,
      error:
        "Tenant has no subscription row. Onboarding may not have completed.",
    };
  }

  if (current.tierId === input.tierId) {
    return {
      ok: false,
      error: `Tenant is already on the ${tier.name} tier.`,
    };
  }

  try {
    await db
      .update(tenantSubscriptions)
      .set({ tierId: input.tierId, updatedAt: new Date() })
      .where(eq(tenantSubscriptions.organizationId, input.organizationId));

    await recordAudit({
      organizationId: input.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "tenant.tier_change",
      resourceType: "tenant_subscription",
      resourceId: input.organizationId,
      metadata: {
        fromTier: { id: current.tierId, name: current.tierName, slug: current.tierSlug },
        toTier: { id: tier.id, name: tier.name, slug: tier.slug },
      },
    });

    revalidatePath(`/admin/orgs/${input.organizationId}`);
    revalidatePath("/admin/tiers");
    return { ok: true };
  } catch (err) {
    log.error("[changeTenantTierAction]", "update failed", {
      error: err,
      organizationId: input.organizationId,
      tierId: input.tierId,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Tier change failed.",
    };
  }
}

/**
 * Lists active tiers in sort-order for the assignment dropdown.
 * Retired tiers are excluded — we don't want superadmins moving
 * tenants ONTO a retired tier (matches the `active` guard in
 * `changeTenantTierAction`).
 */
export async function listActiveTiersAction(): Promise<
  {
    id: string;
    slug: string;
    name: string;
    priceMonthlyCents: number;
    stripePriceIdMonthly: string | null;
    stripePriceIdYearly: string | null;
  }[]
> {
  await requireSuperadmin();

  return db
    .select({
      id: subscriptionTiers.id,
      slug: subscriptionTiers.slug,
      name: subscriptionTiers.name,
      priceMonthlyCents: subscriptionTiers.priceMonthlyCents,
      stripePriceIdMonthly: subscriptionTiers.stripePriceIdMonthly,
      stripePriceIdYearly: subscriptionTiers.stripePriceIdYearly,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.active, true))
    .orderBy(asc(subscriptionTiers.sortOrder));
}

/**
 * BL-15 Phase B-2 — transfer ownership of a tenant.
 *
 * Sets `organization.primary_admin_user_id` to a new user. The new
 * user must already be an active admin of the target org — this
 * action doesn't promote anyone; it just designates the primary
 * among existing admins. Audited.
 */
export async function transferOwnershipAction(input: {
  organizationId: string;
  newPrimaryUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  if (!input.organizationId || !input.newPrimaryUserId) {
    return { ok: false, error: "Pick an organization and a user." };
  }

  // Load the org to confirm it exists + capture the current primary
  // for audit metadata.
  const [org] = await db
    .select({
      id: organizations.id,
      currentPrimaryUserId: organizations.primaryAdminUserId,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!org) {
    return { ok: false, error: "Organization not found." };
  }

  if (org.currentPrimaryUserId === input.newPrimaryUserId) {
    return {
      ok: false,
      error: "That user is already the primary admin.",
    };
  }

  // Verify the new primary is an active admin of THIS org.
  const [candidate] = await db
    .select({
      userId: memberships.userId,
      userName: users.name,
      userEmail: users.email,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.userId, input.newPrimaryUserId),
      ),
    )
    .limit(1);

  if (!candidate) {
    return {
      ok: false,
      error: "User is not a member of this organization.",
    };
  }
  if (candidate.role !== "admin") {
    return {
      ok: false,
      error: "User must have the Admin role to be the primary admin.",
    };
  }
  if (candidate.status !== "active") {
    return {
      ok: false,
      error: "User must be active (not disabled) to be the primary admin.",
    };
  }

  try {
    await db
      .update(organizations)
      .set({
        primaryAdminUserId: input.newPrimaryUserId,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, input.organizationId));

    await recordAudit({
      organizationId: input.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "tenant.transfer_ownership",
      resourceType: "organization",
      resourceId: input.organizationId,
      metadata: {
        fromUserId: org.currentPrimaryUserId,
        toUserId: input.newPrimaryUserId,
        toEmail: candidate.userEmail,
        toName: candidate.userName,
      },
    });

    revalidatePath(`/admin/orgs/${input.organizationId}`);
    return { ok: true };
  } catch (err) {
    log.error("[transferOwnershipAction]", "update failed", {
      error: err,
      organizationId: input.organizationId,
      newPrimaryUserId: input.newPrimaryUserId,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Transfer failed.",
    };
  }
}

/**
 * Lists active admin memberships for the target org — populates the
 * "Transfer ownership" dropdown. Returns user_id + name + email.
 */
export async function listOrgAdminsAction(
  organizationId: string,
): Promise<{ userId: string; name: string | null; email: string }[]> {
  await requireSuperadmin();

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "admin"),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));

  return rows;
}
