import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import type { KnowledgeKind } from "@/db/schema";
import { listKnowledgeEntriesAction } from "./actions";
import { KnowledgeBaseClient } from "./KnowledgeBaseClient";

export const dynamic = "force-dynamic";

const KINDS: { key: KnowledgeKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "capability", label: "Capability" },
  { key: "past_performance", label: "Past performance" },
  { key: "personnel", label: "Personnel" },
  { key: "boilerplate", label: "Boilerplate" },
];

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: { q?: string; kind?: string };
}) {
  await requireAuth();
  await requireCurrentOrg();

  const kind =
    (searchParams.kind as KnowledgeKind | "all" | undefined) ?? "all";
  const search = searchParams.q?.trim() ?? "";

  const all = await listKnowledgeEntriesAction({});
  const filtered = await listKnowledgeEntriesAction({ search, kind });

  const counts = {
    capability: all.filter((e) => e.kind === "capability").length,
    past_performance: all.filter((e) => e.kind === "past_performance").length,
    personnel: all.filter((e) => e.kind === "personnel").length,
    boilerplate: all.filter((e) => e.kind === "boilerplate").length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Knowledge base · Corporate memory"
        title="Knowledge base"
        subtitle="Capabilities, past performance references, named personnel, and boilerplate text — searchable and tag-filtered. Used as grounding when the AI section drafter writes against your real assets."
        actions={
          <Link
            href="/knowledge-base/new"
            className="aur-btn aur-btn-primary"
          >
            + New entry
          </Link>
        }
        meta={[
          {
            label: "Total",
            value: String(all.length).padStart(2, "0"),
          },
          {
            label: "Capabilities",
            value: String(counts.capability).padStart(2, "0"),
          },
          {
            label: "Past performance",
            value: String(counts.past_performance).padStart(2, "0"),
          },
          {
            label: "Personnel",
            value: String(counts.personnel).padStart(2, "0"),
          },
        ]}
      />

      {all.length === 0 ? (
        <Panel title="Empty knowledge base">
          <p className="font-body text-[14px] leading-relaxed text-muted">
            Your knowledge base is empty. Add capabilities, past performance
            references, key personnel bios, and boilerplate text — these
            become grounding for the AI section drafter on every proposal.
          </p>
          <div className="mt-3">
            <Link
              href="/knowledge-base/new"
              className="aur-btn aur-btn-primary"
            >
              + Add your first entry
            </Link>
          </div>
        </Panel>
      ) : (
        <KnowledgeBaseClient
          entries={filtered}
          totalAcrossKinds={all.length}
          activeKind={kind}
          search={search}
          kinds={KINDS}
        />
      )}
    </>
  );
}
