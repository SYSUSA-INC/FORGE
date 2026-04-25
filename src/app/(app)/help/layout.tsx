import { requireAuth } from "@/lib/auth-helpers";
import { HelpTabs } from "@/components/help/HelpTabs";

export const dynamic = "force-dynamic";

export default async function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  const canSeeAdmin = user.role === "admin" || user.isSuperadmin;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
            FORGE · Help
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text">
            User &amp; administrator guide
          </h1>
        </div>
        <a
          href="https://github.com/SYSUSA-INC/FORGE/tree/main/docs"
          target="_blank"
          rel="noreferrer"
          className="aur-btn-ghost text-xs"
        >
          View on GitHub →
        </a>
      </div>

      <HelpTabs canSeeAdmin={canSeeAdmin} />

      <article>{children}</article>
    </div>
  );
}
