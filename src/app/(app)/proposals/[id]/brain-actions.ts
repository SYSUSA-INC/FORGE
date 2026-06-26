"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  knowledgeExtractionCandidates,
  proposalOutcomes,
  proposals,
  type KnowledgeOutcomeLabel,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

export type BrainMineStatus = {
  /** True when this proposal has at least one mined_from_proposal artifact. */
  mined: boolean;
  artifactId: string | null;
  outcomeLabel: KnowledgeOutcomeLabel;
  /** Number of extraction candidates that landed in the review queue. */
  candidateCount: number;
  /** Number of candidates that have been promoted into knowledge_entry. */
  promotedCount: number;
  harvestedAt: string | null;
  /** What outcome the proposal has — drives the UI's call-to-action. */
  outcomeType: string | null;
};

/**
 * BL-FB-X-BRAIN-MINE — surface a proposal's Brain mining state to
 * the proposal overview page. Read-only — the actual harvest is
 * triggered by `harvestProposalToCorpusAction` (existing).
 */
export async function getBrainMineStatusAction(
  proposalId: string,
): Promise<BrainMineStatus> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Verify ownership inline so a typed UUID can't read another tenant's
  // status. Returns a benign "not mined" if the proposal isn't ours.
  const [owns] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!owns) {
    return {
      mined: false,
      artifactId: null,
      outcomeLabel: "none",
      candidateCount: 0,
      promotedCount: 0,
      harvestedAt: null,
      outcomeType: null,
    };
  }

  // Find the harvested artifact for this proposal. metadata.proposalId
  // is the canonical lookup key (see harvestProposalToCorpusAction).
  const [artifactRow] = await db
    .select({
      id: knowledgeArtifacts.id,
      outcomeLabel: knowledgeArtifacts.outcomeLabel,
      metadata: knowledgeArtifacts.metadata,
    })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.organizationId, organizationId),
        eq(knowledgeArtifacts.source, "mined_from_proposal"),
        sql`${knowledgeArtifacts.metadata} ->> 'proposalId' = ${proposalId}`,
      ),
    )
    .limit(1);

  const [outcomeRow] = await db
    .select({ outcomeType: proposalOutcomes.outcomeType })
    .from(proposalOutcomes)
    .where(eq(proposalOutcomes.proposalId, proposalId))
    .limit(1);

  if (!artifactRow) {
    return {
      mined: false,
      artifactId: null,
      outcomeLabel: "none",
      candidateCount: 0,
      promotedCount: 0,
      harvestedAt: null,
      outcomeType: outcomeRow?.outcomeType ?? null,
    };
  }

  const meta = (artifactRow.metadata ?? {}) as Record<string, unknown>;

  const candidateRows = await db
    .select({
      promoted: knowledgeExtractionCandidates.promotedEntryId,
    })
    .from(knowledgeExtractionCandidates)
    .where(eq(knowledgeExtractionCandidates.artifactId, artifactRow.id));

  const candidateCount = candidateRows.length;
  const promotedCount = candidateRows.filter((r) => !!r.promoted).length;

  return {
    mined: true,
    artifactId: artifactRow.id,
    outcomeLabel: artifactRow.outcomeLabel,
    candidateCount,
    promotedCount,
    harvestedAt:
      typeof meta.harvestedAt === "string" ? meta.harvestedAt : null,
    outcomeType: outcomeRow?.outcomeType ?? null,
  };
}
