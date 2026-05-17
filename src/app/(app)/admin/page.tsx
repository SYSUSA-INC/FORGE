import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, memberships, organizations, users } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { AdminClient } from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const actor = await requireSuperadmin();

  const orgRows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      createdAt: organizations.createdAt,
      disabledAt: organizations.disabledAt,
      memberCount: sql<number>`count(DISTINCT ${memberships.userId})`,
    })
    .from(organizations)
    .leftJoin(
      memberships,
      and(
        eq(memberships.organizationId, organizations.id),
        eq(memberships.status, "active"),
      ),
    )
    .groupBy(organizations.id)
    .orderBy(desc(organizations.createdAt));

  const pendingAdminInvites = await db
    .select({
      id: allowlist.id,
      email: allowlist.email,
      organizationId: allowlist.organizationId,
      invitedAt: allowlist.invitedAt,
      consumedAt: allowlist.consumedAt,
    })
    .from(allowlist)
    .where(
      and(
        eq(allowlist.revoked, false),
        isNull(allowlist.consumedAt),
        eq(allowlist.role, "admin"),
      ),
    );

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isSuperadmin: users.isSuperadmin,
      disabledAt: users.disabledAt,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  const userMembershipRows = await db
    .select({
      userId: memberships.userId,
      organizationId: memberships.organizationId,
      organizationName: organizations.name,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId));

  const membershipsByUser = new Map<
    string,
    { organizationId: string; organizationName: string; role: string; status: string }[]
  >();
  for (const m of userMembershipRows) {
    const list = membershipsByUser.get(m.userId) ?? [];
    list.push({
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      role: m.role,
      status: m.status,
    });
    membershipsByUser.set(m.userId, list);
  }

  const pendingByOrg = new Map<
    string,
    { id: string; email: string; invitedAt: string }[]
  >();
  for (const i of pendingAdminInvites) {
    const list = pendingByOrg.get(i.organizationId) ?? [];
    list.push({
      id: i.id,
      email: i.email,
      invitedAt: i.invitedAt.toISOString(),
    });
    pendingByOrg.set(i.organizationId, list);
  }

  const orgs = orgRows.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    createdAt: o.createdAt.toISOString(),
    disabled: !!o.disabledAt,
    memberCount: Number(o.memberCount),
    pendingAdminInvites: pendingByOrg.get(o.id) ?? [],
  }));

  const usersWithOrgs = userRows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isSuperadmin: u.isSuperadmin,
    disabled: !!u.disabledAt,
    verified: !!u.emailVerified,
    createdAt: u.createdAt.toISOString(),
    memberships: membershipsByUser.get(u.id) ?? [],
  }));

  return (
    <AdminClient
      currentUserId={actor.id}
      orgs={orgs}
      users={usersWithOrgs}
      stats={{
        orgCount: orgs.length,
        userCount: usersWithOrgs.length,
        activeOrgs: orgs.filter((o) => !o.disabled).length,
        activeUsers: usersWithOrgs.filter((u) => !u.disabled).length,
        pendingAdminInvites: pendingAdminInvites.length,
      }}
    />
  );
}
