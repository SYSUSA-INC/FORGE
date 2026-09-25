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
import { parseDomainList } from "@/lib/email-domain";
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

/**
 * BL-AUTH-DOMAIN — set the email domains a tenant owns and the external
 * domains a platform admin has approved for it.
 *
 * Superadmin-only: tenant admins must not be able to widen their own
 * tenant's domain list, or the rule ("no one from another domain
 * without platform approval") would be theirs to switch off. Public
 * mailbox providers are refused in both lists. Existing memberships are
 * never touched; the lists only govern who can be invited without a
 * per-invite approval.
 */
export async function setTenantDomainsAction(input: {
  organizationId: string;
  emailDomains: string;
  approvedExternalDomains: string;
}): Promise<
  | { ok: true; emailDomains: string[]; approvedExternalDomains: string[] }
  | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();
  if (!input.organizationId) return { ok: false, error: "Organization not found." };

  const owned = parseDomainList(input.emailDomains ?? "");
  const external = parseDomainList(input.approvedExternalDomains ?? "");
  const problems: string[] = [];
  const invalid = [...owned.invalid, ...external.invalid];
  const publicProviders = [...owned.publicProviders, ...external.publicProviders];
  if (invalid.length > 0) problems.push(`Not a valid domain: ${invalid.join(", ")}.`);
  if (publicProviders.length > 0) {
    problems.push(
      `Public mailbox providers cannot be tenant domains: ${publicProviders.join(", ")}. Approve those people one invite at a time instead.`,
    );
  }
  const overlap = external.domains.filter((d) => owned.domains.includes(d));
  if (overlap.length > 0) {
    problems.push(`Already an owned domain, no need to approve it: ${overlap.join(", ")}.`);
  }
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };

  const [prior] = await db
    .select({
      emailDomains: organizations.emailDomains,
      approvedExternalDomains: organizations.approvedExternalDomains,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!prior) return { ok: false, error: "Organization not found." };

  try {
    await db
      .update(organizations)
      .set({
        emailDomains: owned.domains,
        approvedExternalDomains: external.domains,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, input.organizationId));
    await recordAudit({
      organizationId: input.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "tenant.email_domains_change",
      resourceType: "organization",
      resourceId: input.organizationId,
      metadata: {
        viaSuperadmin: true,
        priorEmailDomains: prior.emailDomains,
        emailDomains: owned.domains,
        priorApprovedExternalDomains: prior.approvedExternalDomains,
        approvedExternalDomains: external.domains,
      },
    });
    revalidatePath(`/admin/orgs/${input.organizationId}`);
    revalidatePath("/users");
    return { ok: true, emailDomains: owned.domains, approvedExternalDomains: external.domains };
  } catch (err) {
    log.error("[setTenantDomainsAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update the domains.",
    };
  }
}

/**
 * BL-ITAR-TAG — flip the ITAR-restricted flag for a tenant.
 *
 * Superadmin-only. Toggles `organization.itar_restricted`. Existing
 * memberships are grandfathered; the gate only fires on new invites.
 * Disabling the flag does NOT retroactively un-attest existing members
 * (their attestation timestamps remain on the membership row).
 */
export async function setItarRestrictedAction(input: {
  organizationId: string;
  itarRestricted: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  const [prior] = await db
    .select({ itarRestricted: organizations.itarRestricted })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!prior) return { ok: false, error: "Organization not found." };
  if (prior.itarRestricted === input.itarRestricted) {
    return { ok: false, error: "No change to apply." };
  }

  try {
    await db
      .update(organizations)
      .set({ itarRestricted: input.itarRestricted, updatedAt: new Date() })
      .where(eq(organizations.id, input.organizationId));
    await recordAudit({
      organizationId: input.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: input.itarRestricted
        ? "tenant.itar_restricted_on"
        : "tenant.itar_restricted_off",
      resourceType: "organization",
      resourceId: input.organizationId,
      metadata: {
        viaSuperadmin: true,
        priorValue: prior.itarRestricted,
        newValue: input.itarRestricted,
      },
    });
    revalidatePath(`/admin/orgs/${input.organizationId}`);
    return { ok: true };
  } catch (err) {
    log.error("[setItarRestrictedAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not update ITAR flag.",
    };
  }
}
