/**
 * BL-AUTH-DOMAIN — cross-domain invite approvals.
 *
 * A cross-domain invite (invitee's domain neither owned by nor approved
 * for the target tenant) is created on hold by the tenant-admin action
 * and becomes usable only when a platform superadmin approves it here.
 * Every write carries the invite's own organization_id; the callers own
 * auth (`requireSuperadmin` for approve / deny, `requireOrgAdmin` for
 * the hold).
 */
import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, organizations, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  domainOf,
  isPublicEmailDomain,
  type TenantDomains,
} from "@/lib/email-domain";
import { emailConfigured, sendCrossDomainApprovalEmail } from "@/lib/email";
import { deliverInvite, type Delivery } from "@/lib/invite-send";
import { issueToken } from "@/lib/tokens";
import { log } from "@/lib/log";

export type HomeOrganization = { id: string; name: string };

/** The active tenant that owns `domain`, if any. */
export async function findHomeOrganization(
  domain: string | null,
): Promise<HomeOrganization | null> {
  if (!domain) return null;
  const [row] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(
      and(
        sql`${organizations.emailDomains} @> ARRAY[${domain}]::text[]`,
        isNull(organizations.disabledAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Same as findHomeOrganization but from an address. */
export async function findHomeOrganizationForEmail(
  email: string,
): Promise<HomeOrganization | null> {
  return findHomeOrganization(domainOf(email));
}

/** Both domain lists for a tenant, or null when the tenant does not exist. */
export async function loadTenantDomains(
  organizationId: string,
): Promise<(TenantDomains & { name: string }) | null> {
  const [row] = await db
    .select({
      name: organizations.name,
      emailDomains: organizations.emailDomains,
      approvedExternalDomains: organizations.approvedExternalDomains,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row ?? null;
}

async function superadminEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.isSuperadmin, true), isNull(users.disabledAt)));
  return rows.map((r) => r.email).filter(Boolean);
}

/**
 * Tell the platform admins an invite is waiting. Best-effort: returns
 * how many mails went out and a note for the UI when email is not
 * configured (the queue on /admin shows the request either way).
 */
export async function notifyPlatformAdmins(input: {
  inviteId: string;
  organizationId: string;
  inviteeEmail: string;
  targetOrganizationName: string;
  homeOrganization: HomeOrganization | null;
  requestedBy: string;
}): Promise<{ notified: number; warning?: string }> {
  const recipients = await superadminEmails();
  if (recipients.length === 0) {
    return { notified: 0, warning: "No platform admin has an email address on file." };
  }
  if (!emailConfigured()) {
    log.warn("[invite-approval]", "approval request created but email is not configured", {
      inviteId: input.inviteId,
      organizationId: input.organizationId,
    });
    return {
      notified: 0,
      warning:
        "Email delivery is not configured, so the platform admins were not emailed. They will see the request under Platform admin → Cross-domain approvals.",
    };
  }
  let notified = 0;
  for (const to of recipients) {
    try {
      await sendCrossDomainApprovalEmail({
        to,
        inviteeEmail: input.inviteeEmail,
        targetOrganizationName: input.targetOrganizationName,
        homeOrganizationName: input.homeOrganization?.name ?? null,
        requestedBy: input.requestedBy,
      });
      notified += 1;
    } catch (err) {
      log.error("[invite-approval]", "approval email failed", { error: err, to });
    }
  }
  return { notified };
}

export type ApprovalOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      inviteId: string;
      inviteeEmail: string;
      /** Set when `allowDomain` added the domain to the tenant's approved list. */
      domainAllowed: string | null;
      delivery: Delivery & { inviteUrl: string };
    };

/**
 * Platform approval: stamp the invite, optionally approve the whole
 * domain for the tenant, then issue the token and deliver the invite.
 */
export async function approveCrossDomainInvite(input: {
  inviteId: string;
  organizationId: string;
  actor: { id: string; email?: string | null; name?: string | null };
  /** Also add the invitee's domain to the tenant's approved external domains. */
  allowDomain?: boolean;
}): Promise<ApprovalOutcome> {
  const [inv] = await db
    .select({
      id: allowlist.id,
      email: allowlist.email,
      role: allowlist.role,
      consumedAt: allowlist.consumedAt,
      revoked: allowlist.revoked,
      crossDomain: allowlist.crossDomain,
      platformApprovedAt: allowlist.platformApprovedAt,
      organizationName: organizations.name,
      approvedExternalDomains: organizations.approvedExternalDomains,
    })
    .from(allowlist)
    .innerJoin(organizations, eq(organizations.id, allowlist.organizationId))
    .where(and(eq(allowlist.id, input.inviteId), eq(allowlist.organizationId, input.organizationId)))
    .limit(1);
  if (!inv) return { ok: false, error: "Invite not found." };
  if (inv.revoked) return { ok: false, error: "Invite was revoked." };
  if (inv.consumedAt) return { ok: false, error: "Invite already accepted." };
  if (!inv.crossDomain) return { ok: false, error: "This invite does not need approval." };

  if (!inv.platformApprovedAt) {
    await db
      .update(allowlist)
      .set({ platformApprovedAt: new Date(), platformApprovedByUserId: input.actor.id })
      .where(and(eq(allowlist.id, inv.id), eq(allowlist.organizationId, input.organizationId)));
  }

  let domainAllowed: string | null = null;
  const domain = domainOf(inv.email);
  if (input.allowDomain && domain && !isPublicEmailDomain(domain)) {
    if (!inv.approvedExternalDomains.some((d) => d.toLowerCase() === domain)) {
      await db
        .update(organizations)
        .set({
          approvedExternalDomains: [...inv.approvedExternalDomains, domain],
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, input.organizationId));
      await recordAudit({
        organizationId: input.organizationId,
        actor: { userId: input.actor.id, email: input.actor.email },
        action: "tenant.approved_domain_add",
        resourceType: "organization",
        resourceId: input.organizationId,
        metadata: { domain, viaSuperadmin: true, fromInviteId: inv.id },
      });
    }
    domainAllowed = domain;
  }

  await recordAudit({
    organizationId: input.organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "user.invite_cross_domain_approve",
    resourceType: "invite",
    resourceId: inv.id,
    metadata: { invitedEmail: inv.email, domain, domainAllowed: !!domainAllowed, viaSuperadmin: true },
  });

  // Approved: the invite becomes usable and the invitee is told.
  const token = await issueToken("invite", inv.id);
  const delivery = await deliverInvite({
    to: inv.email,
    inviteId: inv.id,
    token,
    organizationName: inv.organizationName,
    inviterName: input.actor.name ?? input.actor.email ?? "Platform admin",
    role: inv.role,
    tag: "[invite-approval]",
  });
  await db
    .update(allowlist)
    .set({ invitedAt: new Date() })
    .where(and(eq(allowlist.id, inv.id), eq(allowlist.organizationId, input.organizationId)));
  await recordAudit({
    organizationId: input.organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "user.invite",
    resourceType: "user",
    resourceId: inv.id,
    metadata: {
      invitedEmail: inv.email,
      role: inv.role,
      crossDomain: true,
      platformApproved: true,
      emailSent: delivery.emailSent,
      viaSuperadmin: true,
    },
  });
  return { ok: true, inviteId: inv.id, inviteeEmail: inv.email, domainAllowed, delivery };
}

/** Deny = revoke, with the reason in the audit row. */
export async function denyCrossDomainInvite(input: {
  inviteId: string;
  organizationId: string;
  actor: { id: string; email?: string | null };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [inv] = await db
    .select({ id: allowlist.id, email: allowlist.email, consumedAt: allowlist.consumedAt })
    .from(allowlist)
    .where(and(eq(allowlist.id, input.inviteId), eq(allowlist.organizationId, input.organizationId)))
    .limit(1);
  if (!inv) return { ok: false, error: "Invite not found." };
  if (inv.consumedAt) return { ok: false, error: "Invite already accepted." };
  await db
    .update(allowlist)
    .set({ revoked: true })
    .where(and(eq(allowlist.id, inv.id), eq(allowlist.organizationId, input.organizationId)));
  await recordAudit({
    organizationId: input.organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "user.invite_cross_domain_deny",
    resourceType: "invite",
    resourceId: inv.id,
    metadata: { invitedEmail: inv.email, viaSuperadmin: true },
  });
  return { ok: true };
}

export type PendingApproval = {
  inviteId: string;
  email: string;
  domain: string | null;
  role: string;
  title: string | null;
  invitedAt: string;
  invitedByEmail: string | null;
  organizationId: string;
  organizationName: string;
  homeOrganizationId: string | null;
  homeOrganizationName: string | null;
};

/**
 * Cross-domain invites still waiting for the platform stamp. Without a
 * filter this lists every tenant's requests — it is the platform
 * admin's queue and is only called under `requireSuperadmin()`.
 */
export async function listPendingApprovals(filter: {
  organizationId?: string;
}): Promise<PendingApproval[]> {
  const rows = await db
    .select({
      inviteId: allowlist.id,
      email: allowlist.email,
      role: allowlist.role,
      title: allowlist.title,
      invitedAt: allowlist.invitedAt,
      invitedByEmail: users.email,
      organizationId: allowlist.organizationId,
      organizationName: organizations.name,
      homeOrganizationId: allowlist.homeOrganizationId,
    })
    .from(allowlist)
    .innerJoin(organizations, eq(organizations.id, allowlist.organizationId))
    .leftJoin(users, eq(users.id, allowlist.invitedByUserId))
    .where(
      and(
        eq(allowlist.crossDomain, true),
        eq(allowlist.revoked, false),
        isNull(allowlist.consumedAt),
        isNull(allowlist.platformApprovedAt),
        filter.organizationId ? eq(allowlist.organizationId, filter.organizationId) : undefined,
      ),
    )
    .orderBy(allowlist.invitedAt);

  const homeIds = Array.from(
    new Set(rows.map((r) => r.homeOrganizationId).filter((x): x is string => !!x)),
  );
  const homeNames = new Map<string, string>();
  if (homeIds.length > 0) {
    const homes = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(sql`${organizations.id} = ANY(${homeIds}::uuid[])`);
    for (const h of homes) homeNames.set(h.id, h.name);
  }

  return rows.map((r) => ({
    inviteId: r.inviteId,
    email: r.email,
    domain: domainOf(r.email),
    role: r.role,
    title: r.title,
    invitedAt: r.invitedAt.toISOString(),
    invitedByEmail: r.invitedByEmail ?? null,
    organizationId: r.organizationId,
    organizationName: r.organizationName,
    homeOrganizationId: r.homeOrganizationId,
    homeOrganizationName: r.homeOrganizationId
      ? (homeNames.get(r.homeOrganizationId) ?? null)
      : null,
  }));
}
