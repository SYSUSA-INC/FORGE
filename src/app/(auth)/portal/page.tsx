import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getActiveImpersonationSession } from "@/lib/impersonation";
import {
  portalChoices,
  portalLanding,
  WORKSPACES,
  type Workspace,
} from "@/lib/nav-workspaces";

export const dynamic = "force-dynamic";

/**
 * BL-NAV-PORTAL — choose a portal after sign-in.
 *
 * Sign-in lands here. The account's portals come from its verified
 * session — Super Admin Portal for superadmins, Company Admin Portal for
 * org admins with a tenant, Proposal Tool for any member with a tenant.
 * One portal opens directly; several are offered; none falls through to
 * the work home, which onboards the account. No app shell: the person
 * has not entered a workspace yet.
 */
export default async function PortalPage() {
  const session = await auth();
  const user = session?.user ?? null;
  if (!user) redirect("/sign-in?callbackUrl=%2Fportal");

  const isSuperadmin = user.isSuperadmin ?? false;
  const isOrgAdmin = user.role === "admin" || isSuperadmin;
  // Same rule as the shell: the session's own tenant, or, for a
  // superadmin, an active impersonation session.
  const hasWorkspace =
    Boolean(user.organizationId) ||
    (isSuperadmin && !!user.id && !!(await getActiveImpersonationSession(user.id)));
  const visibility = { isOrgAdmin, isSuperadmin, hasWorkspace };

  const choices = portalChoices(visibility);
  if (choices.length < 2) redirect(portalLanding(visibility));

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
            Choose a portal
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-text">
            Where are you headed?
          </h1>
          <p className="mt-2 text-sm text-muted">
            Your account holds more than one role. Open the portal you need now; the
            sidebar lets you switch later.
          </p>
        </div>

        <ul className="mt-8 grid gap-3">
          {choices.map((c) => (
            <li key={c.workspace}>
              <Link
                href={c.home}
                className="aur-card-elevated flex items-start gap-4 px-6 py-5 transition-colors hover:border-layer/25"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border font-display text-sm font-bold ${BADGE[c.workspace]}`}
                >
                  {WORKSPACES[c.workspace].initial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[15px] font-semibold text-text">
                    {c.title}
                  </span>
                  <span className="mt-1 block font-body text-[13px] leading-relaxed text-muted">
                    {c.description}
                  </span>
                </span>
                <span className="self-center text-teal">→</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-center font-mono text-[11px] text-subtle">
          Signed in as {user.email}
        </p>
      </div>
    </div>
  );
}

const BADGE: Record<Workspace, string> = {
  platform: "border-violet/40 bg-violet/10 text-text",
  company: "border-cobalt/40 bg-cobalt/10 text-text",
  work: "border-emerald/40 bg-emerald/10 text-text",
};
