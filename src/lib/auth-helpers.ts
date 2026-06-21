import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { memberships, type Role } from "@/db/schema";
import { recordAuthDenied } from "@/lib/audit-log";
import { getActiveImpersonationSession } from "@/lib/impersonation";

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
    if (!m) {
      await recordAuthDenied({
        user,
        organizationId: user.organizationId,
        reason: "not_member",
        attemptedOrgId: orgId,
      });
      redirect("/");
    }
  }
  return user;
}

const ORG_ADMIN_ROLES: Role[] = ["admin"];

export async function requireOrgAdmin(orgId: string): Promise<SessionUser> {
  const user = await requireOrgMember(orgId);
  if (user.isSuperadmin) return user;
  if (user.organizationId === orgId) {
    if (user.role && ORG_ADMIN_ROLES.includes(user.role)) return user;
    await recordAuthDenied({
      user,
      organizationId: user.organizationId,
      reason: "not_org_admin",
      attemptedOrgId: orgId,
      metadata: { role: user.role ?? null },
    });
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
  if (!m || !ORG_ADMIN_ROLES.includes(m.role)) {
    await recordAuthDenied({
      user,
      organizationId: user.organizationId,
      reason: "not_org_admin",
      attemptedOrgId: orgId,
      metadata: { role: m?.role ?? null },
    });
    redirect("/");
  }
  return user;
}

export async function requireSuperadmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (!user.isSuperadmin) {
    await recordAuthDenied({
      user,
      organizationId: user.organizationId,
      reason: "not_superadmin",
    });
    redirect("/");
  }
  return user;
}

export type CurrentOrgContext = {
  user: SessionUser;
  organizationId: string;
  /** BL-15 Phase B-3b — true when a super-admin is impersonating this org. */
  isImpersonating: boolean;
  /** Active impersonation session id (when isImpersonating === true). */
  impersonationSessionId?: string;
};

export async function requireCurrentOrg(): Promise<CurrentOrgContext> {
  const user = await requireAuth();

  // BL-15 Phase B-3b — super-admin impersonation override. When the
  // calling super-admin has an active session row + cookie, the
  // effective organizationId becomes the target tenant's. Every
  // downstream query and revalidation reads/writes as that tenant.
  // Mutations are blocked at the middleware layer; this helper does
  // NOT throw on impersonation so read-only browsing works.
  if (user.isSuperadmin) {
    const session = await getActiveImpersonationSession(user.id);
    if (session) {
      return {
        user,
        organizationId: session.targetOrganizationId,
        isImpersonating: true,
        impersonationSessionId: session.id,
      };
    }
  }

  if (!user.organizationId) redirect("/onboarding");
  return {
    user,
    organizationId: user.organizationId,
    isImpersonating: false,
  };
}
