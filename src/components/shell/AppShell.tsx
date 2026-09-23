import Link from "next/link";
import { Suspense } from "react";
import { SideNav } from "@/components/shell/SideNav";
import { MobileNav } from "@/components/shell/MobileNav";
import { SessionClock } from "@/components/shell/SessionClock";
import { NonProdBanner } from "@/components/shell/NonProdBanner";
import { ImpersonationBanner } from "@/components/shell/ImpersonationBanner";
import { UserMenu } from "@/components/auth/UserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { auth } from "@/auth";
import { getActiveImpersonationSession } from "@/lib/impersonation";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user ?? null;
  const isSuperadmin = user?.isSuperadmin ?? false;
  const isOrgAdmin = (user?.role === "admin" || isSuperadmin) ?? false;

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
        user={navUser}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-canvas/70 px-4 backdrop-blur-xl md:gap-4 md:px-6">
          <MobileNav
            isOrgAdmin={isOrgAdmin}
            isSuperadmin={isSuperadmin}
            hasWorkspace={hasWorkspace}
            user={navUser}
          />

          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-emerald" />
            <span className="hidden sm:inline">FORGE · Live</span>
            <span className="sm:hidden">FORGE</span>
          </div>

          <div className="ml-4 hidden min-w-0 flex-1 items-center md:flex">
            <label className="relative flex w-full max-w-md items-center">
              <span className="pointer-events-none absolute left-3 text-muted">⌕</span>
              <input
                placeholder="Search solicitations, proposals, people…"
                className="aur-input pl-8 font-body text-sm"
              />
              <kbd className="absolute right-2 hidden rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted md:inline">
                ⌘K
              </kbd>
            </label>
          </div>

          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <SessionClock />
            {user ? (
              <Suspense fallback={<NotificationBellFallback />}>
                <NotificationBell />
              </Suspense>
            ) : null}
            {hasWorkspace ? (
              <Link href="/settings" className="aur-btn-ghost hidden md:inline-flex">
                Settings
              </Link>
            ) : null}
            <UserMenu user={user} />
          </div>
        </header>

        <main className="relative min-h-[calc(100vh-3.5rem)] flex-1 overflow-x-hidden px-4 py-6 md:px-6 md:py-8 lg:px-10">
          {children}
          <footer className="mt-16 border-t border-white/10 pt-4">
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
    </>
  );
}

function NotificationBellFallback() {
  return (
    <span
      aria-hidden
      className="inline-block h-9 w-9 rounded-md border border-white/10 bg-white/[0.03]"
    />
  );
}
