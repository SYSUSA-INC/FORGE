/**
 * A new workspace with its first admin invited — the platform admin's
 * "New organization" form and (BL-AUTH-ABUSE Slice 2b) an approved trial
 * request both go through here, so they behave the same.
 *
 * The workspace owns its admin's email domain unless that is a public
 * mailbox provider (BL-AUTH-DOMAIN); it lands on the default tier
 * (BL-TIER-ASSIGN); the admin invite goes out by email and the link is
 * returned for sharing by hand (BL-AUTH-INVITE). Audited `org.create` in
 * the new workspace's log. Server-only; callers own auth and input checks.
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, organizations, type Role } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { domainOf, isPublicEmailDomain } from "@/lib/email-domain";
import { deliverInvite } from "@/lib/invite-send";
import { defaultOrgSlug } from "@/lib/org-defaults";
import { ensureTenantSubscription } from "@/lib/tenant-subscription";
import { issueToken } from "@/lib/tokens";

export type ProvisionResult =
  | { ok: true; organizationId: string; inviteId: string; inviteUrl: string | null; emailSent: boolean; warning?: string }
  | { ok: false; error: string };

export async function provisionOrganizationWithAdminInvite(input: {
  orgName: string;
  adminEmail: string;
  adminTitle?: string | null;
  actor: { id: string; email?: string | null; name?: string | null };
  /** Extra fields for the org.create audit row (e.g. the trial request it came from). */
  auditMetadata?: Record<string, unknown>;
}): Promise<ProvisionResult> {
  const orgName = input.orgName.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const adminDomain = domainOf(adminEmail);
  const ownsDomain = !!adminDomain && !isPublicEmailDomain(adminDomain);

  const [org] = await db
    .insert(organizations)
    .values({ name: orgName, slug: defaultOrgSlug(orgName), emailDomains: ownsDomain ? [adminDomain] : [] })
    .returning({ id: organizations.id });
  if (!org) return { ok: false, error: "Could not create organization." };
  const organizationId = org.id;

  const subscription = await ensureTenantSubscription({ organizationId });

  const [invite] = await db
    .insert(allowlist)
    .values({
      email: adminEmail,
      organizationId,
      role: "admin" as Role,
      title: input.adminTitle?.trim() || null,
      invitedByUserId: input.actor.id,
      crossDomain: !ownsDomain,
      platformApprovedAt: ownsDomain ? null : new Date(),
      platformApprovedByUserId: ownsDomain ? null : input.actor.id,
    })
    .returning({ id: allowlist.id });
  if (!invite) {
    await db.delete(organizations).where(eq(organizations.id, organizationId)).catch(() => undefined);
    return { ok: false, error: "Could not create invitation." };
  }

  const token = await issueToken("invite", invite.id);
  const delivery = await deliverInvite({
    to: adminEmail,
    inviteId: invite.id,
    token,
    organizationName: orgName,
    inviterName: input.actor.name ?? input.actor.email ?? "Platform admin",
    role: "admin",
    tag: "[provisionOrganizationWithAdminInvite]",
  });

  await recordAudit({
    organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "org.create",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: {
      name: orgName,
      primaryAdminEmail: adminEmail,
      emailDomains: ownsDomain ? [adminDomain] : [],
      superadmin: true,
      emailSent: delivery.emailSent,
      tier: subscription.tier?.slug ?? null,
      ...(input.auditMetadata ?? {}),
    },
  });

  return { ok: true, organizationId, inviteId: invite.id, inviteUrl: delivery.inviteUrl, emailSent: delivery.emailSent, warning: delivery.warning };
}
