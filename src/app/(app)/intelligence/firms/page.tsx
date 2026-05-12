import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { loadSavedSearchAction } from "../saved-searches/actions";
import { FirmsSearchClient } from "./FirmsSearchClient";

export const dynamic = "force-dynamic";

export default async function FirmsIntelPage({
  searchParams,
}: {
  searchParams: { savedSearch?: string };
}) {
  await requireAuth();
  await requireCurrentOrg();

  const enabled = process.env.AWARDS_INTEL_ENABLED === "1";

  if (!enabled) {
    return (
      <>
        <PageHeader
          eyebrow="Intelligence · BD"
          title="8(a) firms"
          subtitle="Search active and recently graduated 8(a) participants."
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

  // Hydrate initial criteria from a saved-search deep link if present.
  let initial: Record<string, unknown> | null = null;
  if (searchParams.savedSearch) {
    const loaded = await loadSavedSearchAction(searchParams.savedSearch);
    if (loaded?.kind === "firms") initial = loaded.criteria;
  }

  return (
    <>
      <PageHeader
        eyebrow="Intelligence · BD"
        title="8(a) firms"
        subtitle="Search active and recently graduated 8(a) participants. Newly graduated firms are high-value capture targets — they're now competing in open competition for the first time."
        actions={
          <Link href="/intelligence" className="aur-btn aur-btn-ghost">
            ← Intelligence
          </Link>
        }
      />
      <FirmsSearchClient initialCriteria={initial ?? null} />
    </>
  );
}
