import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CorpusUploader } from "./CorpusUploader";
import {
  listKnowledgeArtifactsAction,
  type ListedArtifact,
} from "./actions";
import { ArtifactRow } from "./ArtifactRow";

export const dynamic = "force-dynamic";

export default async function CorpusImportPage() {
  const artifacts = await listKnowledgeArtifactsAction();
  const active = artifacts.filter((a) => !a.archivedAt);
  const totalChars = active.reduce((acc, a) => acc + a.charCount, 0);

  return (
    <>
      <PageHeader
        eyebrow="Knowledge · Corpus"
        title="Drop anything here"
        subtitle="The Brain reads what's in this corpus to build its intelligence. Drop old proposals, RFPs, contracts, debriefs, capability briefs, resumes, brochures — anything that captures historical context."
        actions={
          <Link href="/knowledge-base" className="aur-btn aur-btn-ghost">
            ← Knowledge base
          </Link>
        }
        meta={[
          { label: "Artifacts", value: String(active.length) },
          {
            label: "Indexed text",
            value: formatChars(totalChars),
          },
        ]}
      />

      <Panel title="Upload" eyebrow="Multi-file · 50 MB each">
        <CorpusUploader />
      </Panel>

      <div className="mt-4">
        <Panel
          title="Corpus"
          eyebrow={`${active.length} active${
            artifacts.length > active.length
              ? ` · ${artifacts.length - active.length} archived`
              : ""
          }`}
        >
          {artifacts.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              Empty. Upload a file to seed the corpus.
            </div>
          ) : (
            <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
              {artifacts.map((a) => (
                <ArtifactRow key={a.id} artifact={a} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function formatChars(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Local type re-export so the row component compiles without a circular import.
export type { ListedArtifact };
