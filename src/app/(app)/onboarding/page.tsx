import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations } from "@/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth } from "@/lib/auth-helpers";
import { getSignupMode } from "@/lib/signup-mode";

export const dynamic = "force-dynamic";

/**
 * Landing page for a signed-in user with no active workspace.
 *
 * `requireCurrentOrg()` redirects here whenever the session carries no
 * `organizationId` (auth-helpers.ts). That happens in three distinct
 * situations, and until this route existed every one of them landed on
 * the app's 404 page — so roughly two dozen side-menu links appeared
 * broken while Help and Platform Administration (which don't need an
 * org) kept working.
 *
 * Gated by `requireAuth()` ONLY. Calling `requireCurrentOrg()` here
 * would bounce back to this same URL forever.
 */
export default async function OnboardingPage() {
  const user = await requireAuth();

  // Every membership this user has, including disabled ones and ones
  // pointing at a disabled organization — that is exactly what the
  // session enrichment filters out, and what we need to explain why.
  const rows = await db
    .select({
      organizationId: memberships.organizationId,
      status: memberships.status,
      role: memberships.role,
      orgName: organizations.name,
      orgDisabledAt: organizations.disabledAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, user.id))
    .orderBy(desc(memberships.createdAt));

  const activeInDisabledOrg = rows.filter(
    (r) => r.status === "active" && r.orgDisabledAt !== null,
  );
  const disabledMemberships = rows.filter((r) => r.status !== "active");

  const reason: "no_membership" | "membership_disabled" | "org_disabled" =
    activeInDisabledOrg.length > 0
      ? "org_disabled"
      : disabledMemberships.length > 0
        ? "membership_disabled"
        : "no_membership";

  const signupMode = getSignupMode();

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="No active workspace"
        subtitle="Your account is signed in, but it isn't attached to a workspace right now. Everything that reads tenant data needs one, which is why most of the side menu is unavailable."
        meta={[
          { label: "Signed in as", value: user.email ?? user.id },
          {
            label: "Workspaces",
            value: String(rows.length).padStart(2, "0"),
            accent: rows.length === 0 ? "rose" : "gold",
          },
          {
            label: "Platform admin",
            value: user.isSuperadmin ? "Yes" : "No",
            accent: user.isSuperadmin ? "emerald" : undefined,
          },
        ]}
      />

      <Panel
        title="What happened"
        eyebrow={
          reason === "org_disabled"
            ? "Workspace disabled"
            : reason === "membership_disabled"
              ? "Membership disabled"
              : "No membership"
        }
        accent="gold"
      >
        {reason === "org_disabled" ? (
          <p className="font-body text-[13px] leading-relaxed text-muted">
            You are an active member of{" "}
            <strong className="text-text">
              {activeInDisabledOrg.map((r) => r.orgName).join(", ")}
            </strong>
            , but {activeInDisabledOrg.length === 1 ? "it has" : "they have"} been
            disabled by a platform administrator. Member access stays blocked
            until the workspace is restored — nothing has been deleted.
          </p>
        ) : reason === "membership_disabled" ? (
          <p className="font-body text-[13px] leading-relaxed text-muted">
            Your membership of{" "}
            <strong className="text-text">
              {disabledMemberships.map((r) => r.orgName).join(", ")}
            </strong>{" "}
            is disabled, so the workspace no longer resolves for your session.
            An administrator of that workspace can re-enable it from their
            Users &amp; Roles page.
          </p>
        ) : (
          <p className="font-body text-[13px] leading-relaxed text-muted">
            This account has no workspace membership.{" "}
            {signupMode === "open"
              ? "Self-service sign-up is open on this deployment, so a workspace is normally created on first sign-in — if you are seeing this, that step did not complete. Signing out and back in will retry it."
              : "This deployment is invite-only, so an administrator has to invite your email address before you can join. Ask them to send an invite from Operations Management → Users & Roles."}
          </p>
        )}

        {rows.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1.5">
            {rows.map((r) => (
              <li
                key={r.organizationId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span className="font-display text-[13px] text-text">{r.orgName}</span>
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                  <span className="text-muted">{r.role}</span>
                  <span
                    className={
                      r.status === "active" && r.orgDisabledAt === null
                        ? "text-emerald-300"
                        : "text-rose"
                    }
                  >
                    {r.orgDisabledAt !== null
                      ? "workspace disabled"
                      : r.status === "active"
                        ? "active"
                        : "membership disabled"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Where you can go" className="mt-4">
        <div className="flex flex-col gap-2">
          {user.isSuperadmin ? (
            <>
              <OnboardingLink
                href="/admin"
                eyebrow="Platform administration"
                label="Tenants — create a workspace, re-enable one, or impersonate"
              />
              <OnboardingLink
                href="/admin/migrations"
                eyebrow="Platform administration"
                label="Database migrations & environment marker"
              />
            </>
          ) : null}
          <OnboardingLink href="/help/user" eyebrow="Help" label="User guide" />
          <OnboardingLink href="/help/faq" eyebrow="Help" label="FAQ" />
        </div>
        <p className="mt-3 font-body text-[12px] leading-relaxed text-muted">
          {user.isSuperadmin
            ? "As a platform administrator you keep full access to the Platform Administration surface without belonging to a workspace. Impersonating a tenant from Tenants also gives you a working Command Center for read-only browsing."
            : "Help pages stay available without a workspace. Use the account menu in the header to sign out."}
        </p>
      </Panel>
    </>
  );
}

function OnboardingLink({
  href,
  eyebrow,
  label,
}: {
  href: string;
  eyebrow: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="aur-card flex items-center justify-between px-3 py-2.5 transition-colors hover:border-white/20"
    >
      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {eyebrow}
        </div>
        <div className="mt-0.5 font-display text-[13px] text-text">{label}</div>
      </div>
      <span className="text-teal">→</span>
    </Link>
  );
}
