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
  searchParams: {
    savedSearch?: string;
    status?: string;
    certType?: string;
    naics?: string;
    state?: string;
  };
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

  // Hydrate initial criteria from either a saved-search deep link or
  // direct query-string filters (used by the admin drill-through tiles).
  // Saved-search criteria win when both are present so we don't half-
  // merge two unrelated filter sets.
  let initial: Record<string, unknown> | null = null;
  if (searchParams.savedSearch) {
    const loaded = await loadSavedSearchAction(searchParams.savedSearch);
    if (loaded?.kind === "firms") initial = loaded.criteria;
  } else {
    const fromQuery: Record<string, unknown> = {};
    const status = (searchParams.status || "").trim().toLowerCase();
    if (["active", "graduated", "terminated", "unknown", "all"].includes(status)) {
      fromQuery.status = status;
    }
    if (searchParams.naics) fromQuery.naicsPrefix = searchParams.naics.trim();
    if (searchParams.state) {
      fromQuery.state = searchParams.state.trim().toUpperCase().slice(0, 2);
    }
    if (searchParams.certType) {
      fromQuery.certType = searchParams.certType.trim().toLowerCase();
    }
    if (Object.keys(fromQuery).length > 0) initial = fromQuery;
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
