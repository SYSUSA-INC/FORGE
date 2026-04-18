import Link from "next/link";
import { Ticker } from "@/components/shell/Ticker";
import { SideNav } from "@/components/shell/SideNav";
import { SessionClock } from "@/components/shell/SessionClock";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper">
        <div className="flex items-stretch">
          <Link
            href="/"
            className="flex items-center gap-3 border-r-2 border-ink bg-ink px-5 py-3 text-paper"
          >
            <LogoMark />
            <div className="leading-none">
              <div className="font-display text-lg font-bold tracking-tight">FORGE</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-paper/70">
                Proposal Ops
              </div>
            </div>
          </Link>

          <div className="flex flex-1 items-center justify-between gap-4 px-5">
            <div className="hidden items-center gap-2 lg:flex">
              <span className="brut-pill bg-paper">SYSUSA INC.</span>
              <span className="brut-pill bg-paper text-ink/70">FY 2026 Q2</span>
            </div>
            <div className="flex items-center gap-3">
              <SessionClock />
              <Link href="/settings" className="brut-btn">
                Settings
              </Link>
              <div className="flex items-center gap-2 border-2 border-ink bg-paper px-2 py-1">
                <div className="grid h-7 w-7 place-items-center border-2 border-ink bg-ink font-mono text-xs font-bold text-paper">
                  JC
                </div>
                <div className="font-mono text-[10px] leading-tight">
                  <div className="font-bold uppercase">J. Calder</div>
                  <div className="text-ink/60">Capture Mgr</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Ticker />
      </header>

      <div className="flex">
        <SideNav />
        <main className="relative min-h-[calc(100vh-6rem)] flex-1 overflow-x-hidden p-6 lg:p-10">
          {children}
          <footer className="mt-14 border-t-2 border-ink pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
              <span>FORGE — Framework for Optimized Response Generation &amp; Execution</span>
              <span>Docs · System Status · API</span>
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

function LogoMark() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <rect x="1" y="1" width="28" height="28" stroke="#F5F1E8" strokeWidth="2" />
      <path d="M6 9H24" stroke="#FFD500" strokeWidth="3" />
      <path d="M6 15H20" stroke="#F5F1E8" strokeWidth="2" />
      <path d="M6 21H16" stroke="#F5F1E8" strokeWidth="2" />
    </svg>
  );
}
