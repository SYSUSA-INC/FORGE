import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getKnowledgeEntryAction } from "../actions";
import { EditEntryClient } from "./EditEntryClient";

export const dynamic = "force-dynamic";

export default async function KnowledgeEntryPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  await requireCurrentOrg();

  const row = await getKnowledgeEntryAction(params.id);
  if (!row) notFound();

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
          }}
        />
      </Panel>
    </>
  );
}
