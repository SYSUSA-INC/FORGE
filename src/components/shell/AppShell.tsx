import Link from "next/link";
import { Ticker } from "@/components/shell/Ticker";
import { SideNav } from "@/components/shell/SideNav";
import { SessionClock } from "@/components/shell/SessionClock";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Very top hazard strip */}
      <div className="brut-diagonal-hazard h-2 w-full border-b-2 border-ink" aria-hidden />

      <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper">
        <div className="flex items-stretch">
          <Link
            href="/"
            className="group relative flex items-center gap-3 border-r-2 border-ink bg-ink px-5 py-3 text-paper"
          >
            <LogoMark />
            <div className="leading-none">
              <div className="brut-stencil text-2xl leading-none tracking-tight">FORGE</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.3em] text-paper/70">
                Proposal Ops · v0.1
              </div>
            </div>
            <span className="absolute -right-2 top-1/2 h-3 w-3 -translate-y-1/2 border-2 border-ink bg-hazard" aria-hidden />
          </Link>

          <div className="flex flex-1 items-center justify-between gap-4 px-5">
            <div className="hidden items-center gap-2 lg:flex">
              <span className="brut-pill bg-signal">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-blink bg-ink" />
                LIVE
              </span>
              <span className="brut-pill bg-hazard">SECTION L LOCKED</span>
              <span className="brut-pill">ORG // SYSUSA</span>
              <span className="brut-pill bg-ink text-paper">FY 2026 · Q2</span>
            </div>
            <div className="flex items-center gap-4">
              <SessionClock />
              <Link href="/settings" className="brut-btn">
                Settings
              </Link>
              <div className="flex items-center gap-2 border-2 border-ink bg-bone px-2 py-1">
                <div className="grid h-7 w-7 place-items-center border-2 border-ink bg-blood font-mono text-xs font-bold text-paper">
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
          {/* Decorative corner ink square */}
          <span className="pointer-events-none absolute right-6 top-6 hidden h-4 w-4 bg-ink lg:block" aria-hidden />
          {children}
          <footer className="mt-14 border-t-2 border-ink pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/70">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 bg-blood" />
                FORGE // FRAMEWORK FOR OPTIMIZED RESPONSE GENERATION &amp; EXECUTION
              </span>
              <span>DOCS · SYSTEM STATUS · API</span>
              <span>
                BUILD {process.env.NODE_ENV?.toUpperCase()} · {new Date().getFullYear()}
              </span>
            </div>
            <div className="brut-diagonal mt-3 h-1.5" />
          </footer>
        </main>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="32" height="32" stroke="#F5F1E8" strokeWidth="2" />
      <rect x="1" y="1" width="32" height="8" fill="#FFD500" />
      <path d="M6 6H18" stroke="#0A0A0A" strokeWidth="2" />
      <path d="M6 14H26" stroke="#F5F1E8" strokeWidth="3" />
      <path d="M6 20H20" stroke="#F5F1E8" strokeWidth="3" />
      <path d="M6 26H14" stroke="#E63026" strokeWidth="3" />
      <path d="M18 26H26" stroke="#00E676" strokeWidth="3" />
    </svg>
  );
}
