import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative">
      <div className="brut-diagonal-hazard mb-6 h-14 border-2 border-ink" />
      <div className="border-2 border-ink bg-paper shadow-brut-lg">
        <div className="border-b-2 border-ink bg-blood px-5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-paper">
          ERR // 404 · RECORD NOT FOUND
        </div>
        <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-[auto_1fr] lg:items-end">
          <div className="font-display text-[180px] font-bold leading-none">404</div>
          <div>
            <h1 className="font-display text-5xl font-bold leading-none">NO FILE</h1>
            <p className="mt-3 max-w-xl font-mono text-xs uppercase tracking-wider text-ink/70">
              The requested record is not in the registry. It may have been archived, never existed,
              or is awaiting classification review.
            </p>
            <div className="mt-6 flex gap-2">
              <Link href="/" className="brut-btn-primary">
                ← RETURN TO COMMAND
              </Link>
              <Link href="/solicitations" className="brut-btn">
                SOLICITATIONS
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
