/**
 * Phase 14a — outcome-aware Brain.
 *
 * When a proposal outcome is recorded (won / lost / no_bid / withdrawn),
 * propagate that label onto the harvested artifact for that proposal
 * (via metadata.proposalId) and onto every knowledge_entry that was
 * promoted from candidates of that artifact.
 *
 * Idempotent and Neon-safe (sequential queries, no transactions).
 */
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  knowledgeEntries,
  knowledgeExtractionCandidates,
  type KnowledgeOutcomeLabel,
  type ProposalOutcomeType,
} from "@/db/schema";

// ProposalOutcomeType values are a subset of KnowledgeOutcomeLabel
// (we add 'none' for the unset case). Direct mapping.
function toLabel(t: ProposalOutcomeType): KnowledgeOutcomeLabel {
  return t as KnowledgeOutcomeLabel;
}

export type PropagationResult = {
  artifactsTagged: number;
  entriesTagged: number;
};

export async function propagateOutcomeToCorpus(
  proposalId: string,
  outcomeType: ProposalOutcomeType,
): Promise<PropagationResult> {
  const label = toLabel(outcomeType);

  // 1. Find all harvested artifacts for this proposal. We stored
  //    metadata.proposalId on harvest; query by jsonb path.
  const artifactRows = await db
    .select({ id: knowledgeArtifacts.id })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.source, "mined_from_proposal"),
        sql`${knowledgeArtifacts.metadata} ->> 'proposalId' = ${proposalId}`,
      ),
    );

  if (artifactRows.length === 0) {
    return { artifactsTagged: 0, entriesTagged: 0 };
  }

  const artifactIds = artifactRows.map((r) => r.id);

  // 2. Tag the artifacts.
  await db
    .update(knowledgeArtifacts)
    .set({ outcomeLabel: label, updatedAt: new Date() })
    .where(inArray(knowledgeArtifacts.id, artifactIds));

  // 3. Find every entry promoted from a candidate of any of these
  //    artifacts.
  const promotedRows = await db
    .select({ entryId: knowledgeExtractionCandidates.promotedEntryId })
    .from(knowledgeExtractionCandidates)
    .where(
      and(
        inArray(knowledgeExtractionCandidates.artifactId, artifactIds),
        sql`${knowledgeExtractionCandidates.promotedEntryId} IS NOT NULL`,
      ),
    );

  const entryIds = promotedRows
    .map((r) => r.entryId)
    .filter((id): id is string => Boolean(id));

  if (entryIds.length === 0) {
    return { artifactsTagged: artifactIds.length, entriesTagged: 0 };
  }

  // 4. Tag the entries.
  await db
    .update(knowledgeEntries)
    .set({ outcomeLabel: label, updatedAt: new Date() })
    .where(inArray(knowledgeEntries.id, entryIds));

  return {
    artifactsTagged: artifactIds.length,
    entriesTagged: entryIds.length,
  };
}
