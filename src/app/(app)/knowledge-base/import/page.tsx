import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ClassifyBackfillButton } from "./ClassifyBackfillButton";
import { CorpusList } from "./CorpusList";
import { CorpusUploader } from "./CorpusUploader";
import {
  countClassifyBackfillCandidatesAction,
  listKnowledgeArtifactsAction,
  listTagUsageAction,
  type ListedArtifact,
} from "./actions";
import { SemanticSearchClient } from "./SemanticSearchClient";
import { TagManager } from "./TagManager";
import { getEmbeddingsStatusAction } from "./embed-actions";

export const dynamic = "force-dynamic";

export default async function CorpusImportPage() {
  const [artifacts, embedStatus, classifyCandidateCount, tagUsage] =
    await Promise.all([
      listKnowledgeArtifactsAction(),
      getEmbeddingsStatusAction(),
      countClassifyBackfillCandidatesAction(),
      listTagUsageAction(),
    ]);
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
          {
            label: "Embedded chunks",
            value: embedStatus.chunkCount.toLocaleString(),
          },
        ]}
      />

      <SemanticSearchClient initialStatus={embedStatus} />

      <div className="mt-4">
        <Panel title="Upload" eyebrow="Multi-file · 50 MB each">
          <CorpusUploader />
        </Panel>
      </div>

      {classifyCandidateCount > 0 ? (
        <div className="mt-4">
          <ClassifyBackfillButton candidateCount={classifyCandidateCount} />
        </div>
      ) : null}

      <div className="mt-4">
        <Panel
          title="Corpus"
          eyebrow={`${active.length} active${
            artifacts.length > active.length
              ? ` · ${artifacts.length - active.length} archived`
              : ""
          }`}
        >
          <CorpusList artifacts={artifacts} />
        </Panel>
      </div>

      {tagUsage.length > 0 ? (
        <div className="mt-4">
          <Panel
            title="Tags"
            eyebrow={`${tagUsage.length} in use · rename, merge, or delete`}
          >
            <TagManager tags={tagUsage} />
          </Panel>
        </div>
      ) : null}
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
