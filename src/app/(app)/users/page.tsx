import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, memberships, organizations, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
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
      .select({ itarRestricted: organizations.itarRestricted })
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
      }))}
      pendingInvites={pending.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        title: i.title,
        invitedAt: i.invitedAt.toISOString(),
      }))}
      itarRestricted={orgRow[0]?.itarRestricted ?? false}
      isSuperadmin={actor.isSuperadmin}
      currentOrganizationId={organizationId}
      tenants={tenantRows}
    />
  );
}
