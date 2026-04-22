import Link from "next/link";
import { SideNav } from "@/components/shell/SideNav";
import { MobileNav } from "@/components/shell/MobileNav";
import { SessionClock } from "@/components/shell/SessionClock";
import { UserMenu } from "@/components/auth/UserMenu";
import { auth } from "@/auth";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user ?? null;
  const isOrgAdmin = (user?.role === "admin" || user?.isSuperadmin) ?? false;

  return (
    <div className="flex min-h-screen text-text">
      <SideNav isOrgAdmin={isOrgAdmin} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-canvas/70 px-4 backdrop-blur-xl md:gap-4 md:px-6">
          <MobileNav isOrgAdmin={isOrgAdmin} />

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
            <Link href="/settings" className="aur-btn-ghost hidden md:inline-flex">
              Settings
            </Link>
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
  );
}
