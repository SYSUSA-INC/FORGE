import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getArtifactWithCandidatesAction } from "./actions";
import { CandidateReviewClient } from "./CandidateReviewClient";

export const dynamic = "force-dynamic";

export default async function ArtifactDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getArtifactWithCandidatesAction(params.id);
  if (!data) notFound();

  const { artifact, candidates, runs } = data;
  const pending = candidates.filter((c) => c.decision === "pending").length;
  const approved = candidates.filter((c) => c.decision === "approved").length;
  const rejected = candidates.filter((c) => c.decision === "rejected").length;
  const lastRun = runs[0] ?? null;

  return (
    <>
      <PageHeader
        eyebrow={`Knowledge · Artifact · ${formatKind(artifact.kind)}`}
        title={artifact.title || artifact.fileName || "Untitled artifact"}
        subtitle={[artifact.fileName, formatBytes(artifact.fileSize)]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link
            href="/knowledge-base/import"
            className="aur-btn aur-btn-ghost"
          >
            ← Corpus
          </Link>
        }
        meta={[
          { label: "Status", value: artifact.status.replace(/_/g, " ") },
          {
            label: "Indexed text",
            value: formatChars(artifact.rawText?.length ?? 0),
          },
          { label: "Pending", value: String(pending) },
          {
            label: "Approved",
            value: String(approved),
            accent: approved > 0 ? "emerald" : undefined,
          },
        ]}
      />

      <CandidateReviewClient
        artifactId={artifact.id}
        artifactStatus={artifact.status}
        rawTextChars={artifact.rawText?.length ?? 0}
        candidates={candidates}
        lastRun={lastRun}
        rejectedCount={rejected}
      />

      <div className="mt-4">
        <Panel
          title="Artifact text"
          eyebrow={`${formatChars(artifact.rawText?.length ?? 0)} indexed`}
        >
          {artifact.rawText && artifact.rawText.length > 0 ? (
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-white/[0.015] p-3 font-mono text-[11px] leading-relaxed text-muted">
              {artifact.rawText.slice(0, 50_000)}
              {artifact.rawText.length > 50_000 ? "\n\n…(truncated)" : ""}
            </pre>
          ) : (
            <div className="font-mono text-[11px] text-muted">
              No text indexed yet. If this is an image, vision OCR will run as
              part of Phase 10c+ image extractor.
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function formatChars(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
