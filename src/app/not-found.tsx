import Link from "next/link";

export default function NotFound() {
  return (
    <div className="border-2 border-ink bg-paper shadow-brut">
      <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-paper">
        <span>Error · 404</span>
        <span className="text-paper/60">Record not found</span>
      </div>
      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-[auto_1fr] lg:items-end">
        <div className="font-display text-[160px] font-bold leading-none">404</div>
        <div>
          <h1 className="font-display text-4xl font-bold leading-none">Page not found</h1>
          <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-ink/70">
            The requested record is not in the registry. It may have been archived, never
            existed, or is awaiting classification review.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/" className="brut-btn-primary">
              Return to command
            </Link>
            <Link href="/solicitations" className="brut-btn">
              Solicitations
            </Link>
            <Link href="/proposals" className="brut-btn">
              Proposals
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
