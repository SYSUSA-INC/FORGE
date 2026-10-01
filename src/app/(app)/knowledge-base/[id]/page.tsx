import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listEntryVersions } from "@/lib/entry-versions";
import { getKnowledgeEntryAction } from "../actions";
import { EditEntryClient } from "./EditEntryClient";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

export const dynamic = "force-dynamic";

export default async function KnowledgeEntryPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const row = await getKnowledgeEntryAction(params.id);
  if (!row) notFound();
  // BL-FB-GEN-BLOCKS — the entry's changelog.
  const versions = await listEntryVersions({ organizationId, entryId: row.id }).catch(() => []);

  return (
    <>
      <PageHeader
        eyebrow={`Knowledge · ${row.kind.replace("_", " ")}`}
        title={row.title}
        subtitle={
          row.archivedAt
            ? `Archived ${new Date(row.archivedAt).toISOString().slice(0, 10)}`
            : undefined
        }
        actions={
          <Link href="/knowledge-base" className="aur-btn aur-btn-ghost">
            Back
          </Link>
        }
      />
      <Panel title="Edit entry">
        <EditEntryClient
          id={row.id}
          initial={{
            kind: row.kind,
            title: row.title,
            body: row.body,
            tags: row.tags ?? [],
            archived: !!row.archivedAt,
            qualityScore: row.qualityScore,
            qualityScoreFactors:
              (row.qualityScoreFactors as Record<string, number>) ?? {},
            outcomeLabel: row.outcomeLabel,
          }}
        />
      </Panel>
      <div className="mt-4">
        <Panel
          title="Version history"
          eyebrow={
            versions.length
              ? `${versions.length} version${versions.length === 1 ? "" : "s"}${row.kind === "boilerplate" ? " · content block" : ""}`
              : "Nothing tracked yet"
          }
        >
          <VersionHistoryPanel id={row.id} versions={versions} />
        </Panel>
      </div>
    </>
  );
}
