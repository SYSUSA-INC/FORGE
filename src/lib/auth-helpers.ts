import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { memberships, type Role } from "@/db/schema";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  isSuperadmin: boolean;
  organizationId: string | null;
  role: Role | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user as SessionUser;
}

export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireOrgMember(orgId: string): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.isSuperadmin) return user;
  if (user.organizationId !== orgId) {
    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.organizationId, orgId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!m) redirect("/");
  }
  return user;
}

const ORG_ADMIN_ROLES: Role[] = ["admin"];

export async function requireOrgAdmin(orgId: string): Promise<SessionUser> {
  const user = await requireOrgMember(orgId);
  if (user.isSuperadmin) return user;
  if (user.organizationId === orgId) {
    if (user.role && ORG_ADMIN_ROLES.includes(user.role)) return user;
    redirect("/");
  }
  const [m] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.organizationId, orgId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  if (!m || !ORG_ADMIN_ROLES.includes(m.role)) redirect("/");
  return user;
}

export async function requireSuperadmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (!user.isSuperadmin) redirect("/");
  return user;
}

export async function requireCurrentOrg(): Promise<{
  user: SessionUser;
  organizationId: string;
}> {
  const user = await requireAuth();
  if (!user.organizationId) redirect("/onboarding");
  return { user, organizationId: user.organizationId };
}
