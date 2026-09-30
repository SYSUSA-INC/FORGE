import { Suspense } from "react";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { HeaderSettingsLink, HeaderWorkspace } from "@/components/shell/HeaderWorkspace";
import { SideNav } from "@/components/shell/SideNav";
import { MobileNav } from "@/components/shell/MobileNav";
import { SessionClock } from "@/components/shell/SessionClock";
import { NonProdBanner } from "@/components/shell/NonProdBanner";
import { ImpersonationBanner } from "@/components/shell/ImpersonationBanner";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { UserMenu } from "@/components/auth/UserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getActiveImpersonationSession } from "@/lib/impersonation";
import { isWorkspace, WORKSPACE_COOKIE } from "@/lib/nav-workspaces";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user ?? null;
  const isSuperadmin = user?.isSuperadmin ?? false;
  const isOrgAdmin = (user?.role === "admin" || isSuperadmin) ?? false;

  // BL-NAV-RESTORE — the workspace the person chose with the switcher;
  // read server-side so the first render already shows it.
  const cookieWorkspace = cookies().get(WORKSPACE_COOKIE)?.value;
  const preferredWorkspace = isWorkspace(cookieWorkspace) ? cookieWorkspace : null;

  // BL-QC-links — does this session resolve to a workspace? The same
  // rule requireCurrentOrg() applies: the session's own organizationId,
  // or, for a superadmin, an active impersonation session. Without one,
  // every org-gated page redirects to /onboarding, so the nav hides
  // those groups instead of offering two dozen dead links.
  const hasWorkspace =
    Boolean(user?.organizationId) ||
    (isSuperadmin && !!user?.id && !!(await getActiveImpersonationSession(user.id)));

  // Trim down to what the nav needs — avoid passing the full session
  // user object across the client boundary.
  const navUser = user
    ? {
        name: user.name ?? null,
        email: user.email ?? "",
        image: user.image ?? null,
      }
    : null;

  return (
    <>
      <NonProdBanner />
      {/* BL-15 Phase B-3b — visible when a super-admin is impersonating */}
      <ImpersonationBanner />
      <div className="flex min-h-screen text-text">
        <SideNav
        isOrgAdmin={isOrgAdmin}
        isSuperadmin={isSuperadmin}
        hasWorkspace={hasWorkspace}
        preferredWorkspace={preferredWorkspace}
        user={navUser}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="aur-topline sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-layer/10 bg-canvas/70 px-4 backdrop-blur-xl md:gap-4 md:px-6">
          <MobileNav
            isOrgAdmin={isOrgAdmin}
            isSuperadmin={isSuperadmin}
            hasWorkspace={hasWorkspace}
            preferredWorkspace={preferredWorkspace}
            user={navUser}
          />

          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-emerald" />
            <span className="hidden sm:inline">FORGE · Live</span>
            <span className="sm:hidden">FORGE</span>
          </div>

          {/* BL-NAV-WORKSPACES — search box in everyday work; a console badge otherwise. */}
          <HeaderWorkspace
            isOrgAdmin={isOrgAdmin}
            isSuperadmin={isSuperadmin}
            hasWorkspace={hasWorkspace}
            preferredWorkspace={preferredWorkspace}
          />

          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <SessionClock />
            <ThemeToggle />
            {user ? (
              <Suspense fallback={<NotificationBellFallback />}>
                <NotificationBell />
              </Suspense>
            ) : null}
            <HeaderSettingsLink
              isOrgAdmin={isOrgAdmin}
              isSuperadmin={isSuperadmin}
              hasWorkspace={hasWorkspace}
              preferredWorkspace={preferredWorkspace}
            />
            <UserMenu user={user} />
          </div>
        </header>

        <main className="relative min-h-[calc(100vh-3.5rem)] flex-1 overflow-x-hidden px-4 py-6 md:px-6 md:py-8 lg:px-10">
          {children}
          <footer className="mt-16 border-t border-layer/10 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
              <span>
                FORGE · Framework for Optimized Response Generation &amp; Execution
              </span>
              <span>Docs · System status · API</span>
              <span>
                Build {process.env.NODE_ENV?.toLowerCase()} · {new Date().getFullYear()}
              </span>
            </div>
          </footer>
        </main>
      </div>
      </div>
      {/* BL-AIP-7d — ⌘K: pages, records and Brain answers from one box. */}
      {hasWorkspace ? (
        <CommandPalette isOrgAdmin={isOrgAdmin} isSuperadmin={isSuperadmin} hasWorkspace={hasWorkspace} />
      ) : null}
    </>
  );
}

function NotificationBellFallback() {
  return (
    <span
      aria-hidden
      className="inline-block h-9 w-9 rounded-md border border-layer/10 bg-layer/[0.03]"
    />
  );
}
