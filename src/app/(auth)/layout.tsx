import Link from "next/link";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="aur-topline relative min-h-screen overflow-hidden bg-canvas text-text">
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-3">
          <div className="aur-brand-mark grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow">
            F
          </div>
          <div className="leading-none">
            <div className="font-display text-[15px] font-semibold tracking-tight text-text">
              FORGE
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
              Proposal Ops
            </div>
          </div>
        </Link>
        <ThemeToggle />
      </header>
      <main className="relative z-10 px-4 pb-12">{children}</main>
    </div>
  );
}
