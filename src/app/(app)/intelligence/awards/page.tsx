import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { loadSavedSearchAction } from "../saved-searches/actions";
import { AwardsSearchClient } from "./AwardsSearchClient";

export const dynamic = "force-dynamic";

export default async function AwardsIntelPage({
  searchParams,
}: {
  searchParams: { savedSearch?: string };
}) {
  await requireAuth();
  await requireCurrentOrg();

  const enabled = process.env.AWARDS_INTEL_ENABLED === "1";

  return (
    <>
      <PageHeader
        eyebrow="Intelligence · BD"
        title="Awards & recompetes"
        subtitle="Search federal contract awards by NAICS, agency, or keyword. Surface incumbents whose contracts are ending soon to prioritize recompete pursuit."
        actions={
          <Link href="/intelligence" className="aur-btn aur-btn-ghost">
            ← Intelligence
          </Link>
        }
      />
      {enabled ? (
        <AwardsSearchClient
          initialCriteria={await loadInitial(searchParams.savedSearch)}
        />
      ) : (
        <Panel
          title="Preview feature"
          eyebrow="Disabled by default"
        >
          <p className="font-mono text-[12px] text-muted">
            This feature is in preview and is gated behind the{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5">
              AWARDS_INTEL_ENABLED
            </code>{" "}
            environment variable. Set it to{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5">1</code> on the
            deployment to enable. Source data: USAspending.gov public API (no
            credentials required).
          </p>
        </Panel>
      )}
    </>
  );
}

async function loadInitial(
  id: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const loaded = await loadSavedSearchAction(id);
  if (!loaded || loaded.kind !== "awards") return null;
  return loaded.criteria;
}
