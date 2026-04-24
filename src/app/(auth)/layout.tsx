import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-text">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        aria-hidden
        style={{
          background:
            "radial-gradient(circle at 15% 20%, rgba(45,212,191,0.35) 0%, transparent 40%), radial-gradient(circle at 85% 80%, rgba(236,72,153,0.25) 0%, transparent 40%), radial-gradient(circle at 50% 50%, rgba(52,211,153,0.15) 0%, transparent 60%)",
        }}
      />
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-3">
          <div
            className="grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow"
            style={{
              background:
                "linear-gradient(135deg, #2DD4BF, #34D399 55%, #EC4899 100%)",
            }}
          >
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
      </header>
      <main className="relative z-10 px-4 pb-12">{children}</main>
    </div>
  );
}
