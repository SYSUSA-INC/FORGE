import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listSavedSearches } from "./actions";
import { SavedSearchesClient } from "./SavedSearchesClient";

export const dynamic = "force-dynamic";

export default async function SavedSearchesPage() {
  await requireAuth();
  await requireCurrentOrg();

  const enabled = process.env.AWARDS_INTEL_ENABLED === "1";

  if (!enabled) {
    return (
      <>
        <PageHeader
          eyebrow="Intelligence · BD"
          title="Saved searches"
          subtitle="Re-run favorite searches against awards and firms."
          actions={
            <Link href="/intelligence" className="aur-btn aur-btn-ghost">
              ← Intelligence
            </Link>
          }
        />
        <Panel title="Preview feature" eyebrow="Disabled by default">
          <p className="font-mono text-[12px] text-muted">
            Gated behind{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5">
              AWARDS_INTEL_ENABLED
            </code>
            .
          </p>
        </Panel>
      </>
    );
  }

  const rows = await listSavedSearches();

  return (
    <>
      <PageHeader
        eyebrow="Intelligence · BD"
        title="Saved searches"
        subtitle="Run a search again with one click. Shared ones are visible to everyone in your org."
        actions={
          <Link href="/intelligence" className="aur-btn aur-btn-ghost">
            ← Intelligence
          </Link>
        }
      />
      <SavedSearchesClient rows={rows} />
    </>
  );
}
