"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  knowledgeEntries,
  opportunities,
  proposalSections,
  proposals,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { embedBatch, vectorToPgLiteral } from "@/lib/embeddings";

export type BrainHit = {
  source: "corpus" | "entry";
  /** Stable id — chunkId for corpus, entry id for entries. */
  id: string;
  artifactId?: string;
  artifactTitle?: string;
  artifactKind?: string;
  entryKind?: "capability" | "past_performance" | "personnel" | "boilerplate";
  title: string;
  content: string;
  similarity: number;
};

export type BrainSuggestResult =
  | { ok: true; hits: BrainHit[]; provider: string; stubbed: boolean }
  | { ok: false; error: string };

/**
 * Brain suggest: given a proposal section, run a semantic search
 * across the org's corpus + structured knowledge entries and return
 * the highest-similarity matches the writer can drop into the draft.
 *
 * The query is composed from:
 *   1. The user's optional free-text query (highest weight)
 *   2. The section title + kind
 *   3. The opportunity's agency / NAICS / set-aside / keywords
 *
 * We search BOTH the chunked corpus (knowledge_artifact_chunk) and
 * the curated knowledge entries (knowledge_entry) and merge results.
 * Curated entries get a small similarity bonus because they've been
 * reviewer-approved.
 */
export async function brainSuggestForSectionAction(
  sectionId: string,
  freeText: string,
): Promise<BrainSuggestResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      sectionTitle: proposalSections.title,
      sectionKind: proposalSections.kind,
      proposalId: proposalSections.proposalId,
      proposalTitle: proposals.title,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      oppDescription: opportunities.description,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposalSections.id, sectionId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Section not found." };

  // Compose the query. Free text is the strongest signal; the rest
  // adds context so the embedding lands in roughly the right
  // neighborhood when the user just hits Suggest with no input.
  const composed = [
    freeText.trim(),
    `Section: ${row.sectionTitle} (${row.sectionKind.replace(/_/g, " ")})`,
    row.agency ? `Agency: ${row.agency}` : "",
    row.naicsCode ? `NAICS ${row.naicsCode}` : "",
    row.setAside ? `Set-aside: ${row.setAside}` : "",
    row.oppDescription ? `Opportunity: ${row.oppDescription.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (composed.trim().length < 6) {
    return { ok: false, error: "Not enough context to suggest." };
  }

  let queryVec: number[];
  let provider = "stub";
  let stubbed = true;
  try {
    const r = await embedBatch([composed]);
    queryVec = r.vectors[0]!;
    provider = r.provider;
    stubbed = r.stubbed;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Embedding failed.",
    };
  }
  const literal = vectorToPgLiteral(queryVec);

  // Pull top corpus chunks (up to 8) and top approved entries (up to
  // 6) in parallel. We over-fetch slightly so the merge has room to
  // dedupe and rank.
  let corpusRows: Array<{
    chunk_id: string;
    artifact_id: string;
    artifact_title: string;
    artifact_kind: string;
    content: string;
    similarity: number;
  }> = [];
  let entryRows: Array<{
    id: string;
    kind: "capability" | "past_performance" | "personnel" | "boilerplate";
    title: string;
    body: string;
    similarity: number;
  }> = [];

  try {
    const r1 = await db.execute(sql`
      SELECT
        c.id           AS chunk_id,
        c.content      AS content,
        a.id           AS artifact_id,
        a.title        AS artifact_title,
        a.kind         AS artifact_kind,
        1 - (c.embedding <=> ${literal}::vector) AS similarity
      FROM knowledge_artifact_chunk c
      INNER JOIN knowledge_artifact a ON a.id = c.artifact_id
      WHERE c.organization_id = ${organizationId}
        AND a.archived_at IS NULL
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT 8
    `);
    corpusRows = ((r1 as unknown as { rows?: typeof corpusRows }).rows ??
      (r1 as unknown as typeof corpusRows)) as typeof corpusRows;
  } catch (err) {
    console.warn("[brainSuggest] corpus query failed", err);
  }

  // Phase 10f: knowledge_entry rows now carry embeddings, so we can
  // run real cosine similarity instead of token overlap. We
  // gracefully fall back to overlap if no entries are embedded yet
  // (e.g. backfill hasn't run on a fresh deploy).
  try {
    const r2 = await db.execute(sql`
      SELECT
        id,
        kind,
        title,
        body,
        1 - (embedding <=> ${literal}::vector) AS similarity
      FROM knowledge_entry
      WHERE organization_id = ${organizationId}
        AND archived_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${literal}::vector
      LIMIT 6
    `);
    entryRows = ((r2 as unknown as { rows?: typeof entryRows }).rows ??
      (r2 as unknown as typeof entryRows)) as typeof entryRows;
    entryRows = entryRows.map((e) => ({
      ...e,
      similarity:
        typeof e.similarity === "string" ? Number(e.similarity) : e.similarity,
    }));
  } catch (err) {
    console.warn("[brainSuggest] entry vector query failed, falling back to token overlap", err);
  }

  if (entryRows.length === 0) {
    // Fallback: token-overlap on un-embedded entries.
    try {
      const all = await db
        .select({
          id: knowledgeEntries.id,
          kind: knowledgeEntries.kind,
          title: knowledgeEntries.title,
          body: knowledgeEntries.body,
        })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.organizationId, organizationId))
        .limit(200);

      const queryLower = composed.toLowerCase();
      const tokens = Array.from(
        new Set(
          queryLower
            .match(/[a-z0-9]{3,}/g)
            ?.filter((t) => !STOPWORDS.has(t)) ?? [],
        ),
      );
      if (tokens.length > 0) {
        entryRows = all
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            title: e.title,
            body: e.body,
            similarity: scoreOverlap(
              (e.title + " " + e.body).toLowerCase(),
              tokens,
            ),
          }))
          .filter((e) => e.similarity > 0)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 6);
      }
    } catch (err) {
      console.warn("[brainSuggest] entry overlap query failed", err);
    }
  }

  // Merge + rank. Curated entries get a +0.05 bonus to break ties in
  // their favor when a corpus chunk and an entry score equally.
  const hits: BrainHit[] = [
    ...corpusRows.map<BrainHit>((r) => ({
      source: "corpus",
      id: r.chunk_id,
      artifactId: r.artifact_id,
      artifactTitle: r.artifact_title,
      artifactKind: r.artifact_kind,
      title: r.artifact_title || "(untitled artifact)",
      content: r.content,
      similarity:
        typeof r.similarity === "string" ? Number(r.similarity) : r.similarity,
    })),
    ...entryRows.map<BrainHit>((r) => ({
      source: "entry",
      id: r.id,
      entryKind: r.kind,
      title: r.title,
      content: r.body,
      similarity: r.similarity + 0.05,
    })),
  ]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 8);

  return { ok: true, hits, provider, stubbed };
}

function scoreOverlap(haystack: string, tokens: string[]): number {
  let matched = 0;
  for (const t of tokens) {
    if (haystack.includes(t)) matched += 1;
  }
  if (tokens.length === 0) return 0;
  // Normalize to [0, 1] roughly — gives entries similar shape to
  // cosine similarity. Not strictly comparable but close enough for
  // ranking.
  return matched / tokens.length;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "are",
  "was",
  "were",
  "from",
  "into",
  "they",
  "their",
  "have",
  "has",
  "had",
  "but",
  "not",
  "you",
  "your",
  "our",
  "any",
  "all",
  "each",
  "such",
  "shall",
  "will",
  "may",
  "include",
  "including",
  "section",
  "agency",
  "naics",
  "proposal",
  "naics",
  "rfp",
]);
