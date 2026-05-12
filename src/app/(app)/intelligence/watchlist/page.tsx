import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listWatchlistRows } from "./actions";
import { WatchlistClient } from "./WatchlistClient";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  await requireAuth();
  await requireCurrentOrg();

  const enabled = process.env.AWARDS_INTEL_ENABLED === "1";

  if (!enabled) {
    return (
      <>
        <PageHeader
          eyebrow="Intelligence · BD"
          title="Watchlist"
          subtitle="Pinned awards and firms your team is tracking."
          actions={
            <Link href="/intelligence" className="aur-btn aur-btn-ghost">
              ← Intelligence
            </Link>
          }
        />
        <Panel title="Preview feature" eyebrow="Disabled by default">
          <p className="font-mono text-[12px] text-muted">
            The watchlist is gated behind{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5">
              AWARDS_INTEL_ENABLED
            </code>
            . Set it to <code className="rounded bg-white/5 px-1.5 py-0.5">1</code>{" "}
            on the deployment to enable.
          </p>
        </Panel>
      </>
    );
  }

  const rows = await listWatchlistRows();

  return (
    <>
      <PageHeader
        eyebrow="Intelligence · BD"
        title="Watchlist"
        subtitle="Pinned awards and firms your team is tracking. Add notes; saved here, visible to your whole org."
        actions={
          <Link href="/intelligence" className="aur-btn aur-btn-ghost">
            ← Intelligence
          </Link>
        }
      />
      <WatchlistClient rows={rows} />
    </>
  );
}
