import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative">
      <div className="brut-diagonal-hazard mb-6 h-14 border-2 border-ink" />
      <div className="relative border-2 border-ink bg-paper shadow-brut-xl">
        <div className="flex items-center justify-between border-b-2 border-ink bg-blood px-5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-paper">
          <span>ERR // 404 · RECORD NOT FOUND</span>
          <span>CLASS · CUI</span>
        </div>
        <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-[auto_1fr] lg:items-end">
          <div className="brut-stencil text-[220px] leading-[0.82]">404</div>
          <div>
            <h1 className="font-display text-5xl font-black leading-none">NO FILE</h1>
            <p className="mt-3 max-w-xl font-mono text-xs uppercase tracking-wider text-ink/70">
              The requested record is not in the registry. It may have been archived, never
              existed, or is awaiting classification review.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/" className="brut-btn-primary">
                ← RETURN TO COMMAND
              </Link>
              <Link href="/solicitations" className="brut-btn">
                SOLICITATIONS
              </Link>
              <Link href="/proposals" className="brut-btn">
                PROPOSALS
              </Link>
            </div>
          </div>
        </div>
        <span
          className="pointer-events-none absolute right-8 top-24 border-[3px] border-blood px-3 py-1 font-display text-[11px] font-black uppercase tracking-[0.22em] text-blood"
          style={{ transform: "rotate(-9deg)" }}
        >
          ✦ FILE NOT FOUND ✦
        </span>
      </div>
    </div>
  );
}
