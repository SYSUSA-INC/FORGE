import Link from "next/link";
import { auth } from "@/auth";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const signedIn = !!session?.user;

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
        <nav className="flex items-center gap-3">
          <Link
            href="/pricing"
            className="font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text"
          >
            Pricing
          </Link>
          {signedIn ? (
            <Link href="/" className="aur-btn aur-btn-primary text-[12px]">
              Go to app →
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="aur-btn aur-btn-primary text-[12px]"
              >
                Get started →
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="relative z-10 px-4 pb-20">{children}</main>
      <footer className="relative z-10 border-t border-white/5 px-6 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-muted md:px-10">
        © {new Date().getFullYear()} FORGE · Proposal Ops for federal & commercial procurement
      </footer>
    </div>
  );
}
