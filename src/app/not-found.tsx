import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-xl px-4">
      <div className="aur-card p-8">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-label text-accent">
          <span className="aur-diamond" />
          Error · 404
        </div>
        <h1 className="mt-3 font-display text-[34px] font-normal leading-[1.1] tracking-headline text-text">
          Page not found
        </h1>
        <p className="mt-3 font-body text-[14px] leading-relaxed text-muted">
          The record may have been archived or deleted, or the link may be
          mistyped.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/" className="aur-btn-primary">
            Command Center
          </Link>
          <Link href="/solicitations" className="aur-btn">
            Solicitations
          </Link>
          <Link href="/proposals" className="aur-btn">
            Proposals
          </Link>
        </div>
      </div>
    </div>
  );
}
