import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import { allowlist, memberships, organizations, users } from "@/db/schema";
import { recordRead } from "@/lib/audit-log";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { TenantUsersClient } from "./TenantUsersClient";

export const dynamic = "force-dynamic";

/**
 * BL-15 Phase B-3a — SuperAdmin per-tenant user management.
 *
 * Operator surface for the "tenant is stuck" cases the BL-15 spec
 * called out:
 *   - Primary admin left without promoting a replacement
 *   - User locked out / disabled and can't be re-enabled by tenant
 *     because no admin is left
 *   - Stuck pending invite (revoke + re-issue)
 *   - Member needs to be promoted to admin
 *
 * Read-only metadata renders for every member: role, status, joined
 * date, last sign-in, verified email status. Action affordances live
 * client-side in `TenantUsersClient`.
 *
 * Every action writes to the TARGET tenant's audit log (with
 * `viaSuperadmin: true` in metadata) so the tenant's own admins can
 * later see what platform support did on their behalf.
 */
export default async function TenantUsersPage({
  params,
}: {
  params: { id: string };
}) {
  const actor = await requireSuperadmin();

  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      disabledAt: organizations.disabledAt,
      primaryAdminUserId: organizations.primaryAdminUserId,
    })
    .from(organizations)
    .where(eq(organizations.id, params.id))
    .limit(1);

  if (!org) notFound();

  const [memberRows, inviteRows] = await Promise.all([
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        userDisabledAt: users.disabledAt,
        role: memberships.role,
        status: memberships.status,
        title: memberships.title,
        joinedAt: memberships.createdAt,
        emailVerified: users.emailVerified,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, org.id))
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
      })
      .from(allowlist)
      .where(
        and(
          eq(allowlist.organizationId, org.id),
          eq(allowlist.revoked, false),
        ),
      )
      .orderBy(desc(allowlist.invitedAt)),
  ]);

  const pendingInvites = inviteRows.filter((i) => !i.consumedAt);

  const activeAdminCount = memberRows.filter(
    (m) => m.role === "admin" && m.status === "active",
  ).length;

  await recordRead({
    organizationId: org.id,
    actor: { userId: actor.id, email: actor.email },
    action: "tenant.view_users",
    resourceType: "organization",
    resourceId: org.id,
    metadata: {
      memberCount: memberRows.length,
      pendingInvites: pendingInvites.length,
      activeAdmins: activeAdminCount,
    },
  });

  return (
    <>
      <PageHeader
        eyebrow={`Tenant users · ${org.slug}`}
        title={`${org.name} — users`}
        subtitle="Manage members of this tenant on behalf of platform support. Every change is audit-logged into the tenant's own log with a viaSuperadmin flag."
        actions={
          <>
            <Link
              href={`/admin/orgs/${org.id}`}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              ← Tenant detail
            </Link>
            <Link
              href={`/admin/orgs/${org.id}/activity`}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              Activity →
            </Link>
          </>
        }
        meta={[
          { label: "Members", value: String(memberRows.length) },
          {
            label: "Active admins",
            value: String(activeAdminCount),
            accent: activeAdminCount === 0 ? "rose" : "emerald",
          },
          {
            label: "Pending invites",
            value: String(pendingInvites.length),
            accent: pendingInvites.length > 0 ? "violet" : undefined,
          },
        ]}
      />

      {activeAdminCount === 0 ? (
        <Panel title="⚠ No active admins">
          <p className="font-body text-[13px] leading-relaxed text-rose">
            This tenant has zero active admins. No one inside the tenant
            can manage users, change settings, or invite new people.
            Promote a member to admin below, or invite a new admin via{" "}
            <Link
              href="/admin"
              className="text-violet underline-offset-2 hover:underline"
            >
              the SuperAdmin portal&apos;s &quot;Invite admin&quot; form
            </Link>
            .
          </p>
        </Panel>
      ) : null}

      <TenantUsersClient
        organizationId={org.id}
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
          userGloballyDisabled: !!m.userDisabledAt,
          isPrimaryAdmin: m.userId === org.primaryAdminUserId,
        }))}
        pendingInvites={pendingInvites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          title: i.title,
          invitedAt: i.invitedAt.toISOString(),
        }))}
        activeAdminCount={activeAdminCount}
      />
    </>
  );
}
