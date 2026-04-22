import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, memberships, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const memberRows = await db
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
    .orderBy(desc(memberships.createdAt));

  const inviteRows = await db
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
    .orderBy(desc(allowlist.invitedAt));

  const pending = inviteRows.filter((i) => !i.consumedAt);

  return (
    <UsersClient
      currentUserId={actor.id}
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
    />
  );
}
