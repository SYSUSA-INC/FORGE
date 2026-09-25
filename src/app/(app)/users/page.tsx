import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, memberships, organizations, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { inviteAwaitsApproval, tenantAllowsEmail } from "@/lib/email-domain";
import { getMembersSummary } from "@/lib/settings-status";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [memberRows, inviteRows, summary, orgRow, tenantRows] = await Promise.all([
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: memberships.role,
        status: memberships.status,
        title: memberships.title,
        joinedAt: memberships.createdAt,
        emailVerified: users.emailVerified,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(desc(memberships.createdAt)),
    db
      .select({
        id: allowlist.id,
        email: allowlist.email,
        role: allowlist.role,
        title: allowlist.title,
        invitedAt: allowlist.invitedAt,
        consumedAt: allowlist.consumedAt,
        revoked: allowlist.revoked,
        invitedByUserId: allowlist.invitedByUserId,
        crossDomain: allowlist.crossDomain,
        platformApprovedAt: allowlist.platformApprovedAt,
      })
      .from(allowlist)
      .where(
        and(
          eq(allowlist.organizationId, organizationId),
          eq(allowlist.revoked, false),
        ),
      )
      .orderBy(desc(allowlist.invitedAt)),
    getMembersSummary(organizationId),
    db
      .select({
        itarRestricted: organizations.itarRestricted,
        emailDomains: organizations.emailDomains,
        approvedExternalDomains: organizations.approvedExternalDomains,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
    // BL-AUTH-INVITE — a platform superadmin picks the tenant explicitly
    // (mandatory) instead of inheriting it from the session. Tenant
    // admins never see this list.
    actor.isSuperadmin
      ? db
          .select({
            id: organizations.id,
            name: organizations.name,
            itarRestricted: organizations.itarRestricted,
          })
          .from(organizations)
          .where(isNull(organizations.disabledAt))
          .orderBy(asc(organizations.name))
      : Promise.resolve([] as { id: string; name: string; itarRestricted: boolean }[]),
  ]);

  const pending = inviteRows.filter((i) => !i.consumedAt);

  // BL-AUTH-DOMAIN — the tenant's domain lists drive the invite panel's
  // hint and the "external domain" badge on members who joined before
  // the rule (or were approved by a platform admin).
  const tenantDomains = {
    emailDomains: orgRow[0]?.emailDomains ?? [],
    approvedExternalDomains: orgRow[0]?.approvedExternalDomains ?? [],
  };

  return (
    <UsersClient
      currentUserId={actor.id}
      summary={summary}
      members={memberRows.map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        image: m.image,
        role: m.role,
        status: m.status,
        title: m.title,
        joinedAt: m.joinedAt.toISOString(),
        verified: !!m.emailVerified,
        externalDomain: !tenantAllowsEmail(m.email, tenantDomains),
      }))}
      pendingInvites={pending.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        title: i.title,
        invitedAt: i.invitedAt.toISOString(),
        awaitingApproval: inviteAwaitsApproval(i),
      }))}
      itarRestricted={orgRow[0]?.itarRestricted ?? false}
      tenantDomains={tenantDomains}
      isSuperadmin={actor.isSuperadmin}
      currentOrganizationId={organizationId}
      tenants={tenantRows}
    />
  );
}
