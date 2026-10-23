import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { formatLimit, resolvePolicy } from "@/lib/upload-policy";
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
// BL-STAB-2e — room for saving uploaded files and starting their extraction from this page.
export const maxDuration = 300;

export default async function CorpusImportPage() {
  // Every action below re-gates, but the route's protection should be
  // visible in the route file itself (BL-TENANT-AUDIT 2026-09).
  await requireAuth();
  await requireCurrentOrg();
  // The per-file limit as this deployment sets it (UPLOAD_MAX_FILE_MB), handed to the browser's own check.
  const maxBytes = resolvePolicy("document", process.env).maxBytes;
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
          <Link href="/knowledge-base" className="aur-link">
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
        <Panel title="Upload" eyebrow={`Multi-file · up to ${formatLimit(maxBytes)} each`}>
          <CorpusUploader maxBytes={maxBytes} />
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
