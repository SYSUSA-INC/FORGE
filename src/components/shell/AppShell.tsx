import Link from "next/link";
import { SideNav } from "@/components/shell/SideNav";
import { SessionClock } from "@/components/shell/SessionClock";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen text-text">
      <SideNav />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-white/10 bg-canvas/70 px-6 backdrop-blur-xl">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-emerald" />
            FORGE · Live
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

          <div className="ml-auto flex items-center gap-3">
            <SessionClock />
            <Link href="/settings" className="aur-btn-ghost">
              Settings
            </Link>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1">
              <span
                className="grid h-7 w-7 place-items-center rounded-full font-mono text-[10px] font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, #8B5CF6 0%, #D946EF 100%)",
                }}
              >
                JC
              </span>
              <div className="pr-1 font-mono text-[10px] leading-tight">
                <div className="font-semibold text-text">J. Calder</div>
                <div className="text-muted">Capture Mgr</div>
              </div>
            </div>
          </div>
        </header>

        <main className="relative min-h-[calc(100vh-3.5rem)] flex-1 overflow-x-hidden px-6 py-8 lg:px-10">
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
