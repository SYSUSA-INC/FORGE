/**
 * Brain retrieval — semantic search over the org's corpus + curated
 * knowledge entries, with the Phase 14a outcome boost.
 *
 * Extracted from `brainSuggestForSectionAction` (BL-FB-GEN-CITE) so the
 * section drafter can pull the same sources the writer sees in Brain
 * Suggest. Every query is scoped by the caller-supplied organizationId;
 * callers own auth. Server-only lib, not an action.
 */
import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries } from "@/db/schema";
import { embedBatch, vectorToPgLiteral } from "@/lib/embeddings";
import { log } from "@/lib/log";

export type BrainOutcomeLabel = "none" | "won" | "lost" | "no_bid" | "withdrawn";
export type BrainEntryKind = "capability" | "past_performance" | "personnel" | "boilerplate";

export type BrainHit = {
  source: "corpus" | "entry";
  /** Stable id — chunkId for corpus, entry id for entries. */
  id: string;
  artifactId?: string;
  artifactTitle?: string;
  artifactKind?: string;
  entryKind?: BrainEntryKind;
  /** Phase 14a — provenance signal so the writer can prefer winning content. */
  outcomeLabel?: BrainOutcomeLabel;
  title: string;
  content: string;
  similarity: number;
};

export type BrainSearchResult =
  | { ok: true; hits: BrainHit[]; provider: string; stubbed: boolean }
  | { ok: false; error: string };

/**
 * Phase 14a — outcome-aware retrieval bonus. Won content rises, lost
 * content is slightly demoted; no_bid / withdrawn / none stay neutral.
 */
export function outcomeBoost(label: string | null | undefined): number {
  switch (label) {
    case "won":
      return 0.1;
    case "lost":
      return -0.05;
    default:
      return 0;
  }
}

/**
 * Search corpus chunks and curated entries for `query`, merge and rank.
 * Curated entries get a +0.05 tie-break because they are reviewer-approved.
 */
export async function searchBrain(input: {
  organizationId: string;
  query: string;
  corpusLimit?: number;
  entryLimit?: number;
  take?: number;
}): Promise<BrainSearchResult> {
  const { organizationId } = input;
  const composed = input.query.trim();
  const corpusLimit = input.corpusLimit ?? 8;
  const entryLimit = input.entryLimit ?? 6;
  const take = input.take ?? 8;

  if (composed.length < 6) {
    return { ok: false, error: "Not enough context to search." };
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

  type CorpusRow = {
    chunk_id: string;
    artifact_id: string;
    artifact_title: string;
    artifact_kind: string;
    artifact_outcome: string;
    content: string;
    similarity: number | string;
  };
  type EntryRow = {
    id: string;
    kind: BrainEntryKind;
    title: string;
    body: string;
    outcome_label: string;
    similarity: number | string;
  };

  let corpusRows: CorpusRow[] = [];
  let entryRows: EntryRow[] = [];

  try {
    const r1 = await db.execute(sql`
      SELECT
        c.id              AS chunk_id,
        c.content         AS content,
        a.id              AS artifact_id,
        a.title           AS artifact_title,
        a.kind            AS artifact_kind,
        a.outcome_label   AS artifact_outcome,
        1 - (c.embedding <=> ${literal}::vector) AS similarity
      FROM knowledge_artifact_chunk c
      INNER JOIN knowledge_artifact a ON a.id = c.artifact_id
      WHERE c.organization_id = ${organizationId}
        AND a.archived_at IS NULL
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${corpusLimit}
    `);
    corpusRows = ((r1 as unknown as { rows?: CorpusRow[] }).rows ??
      (r1 as unknown as CorpusRow[])) as CorpusRow[];
  } catch (err) {
    log.warn("[searchBrain]", "corpus query failed", { error: err });
  }

  try {
    const r2 = await db.execute(sql`
      SELECT
        id,
        kind,
        title,
        body,
        outcome_label,
        1 - (embedding <=> ${literal}::vector) AS similarity
      FROM knowledge_entry
      WHERE organization_id = ${organizationId}
        AND archived_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${entryLimit}
    `);
    entryRows = ((r2 as unknown as { rows?: EntryRow[] }).rows ??
      (r2 as unknown as EntryRow[])) as EntryRow[];
  } catch (err) {
    log.warn("[searchBrain]", "entry vector query failed, falling back to token overlap", {
      error: err,
    });
  }

  if (entryRows.length === 0) {
    // Fallback: token overlap on un-embedded entries (fresh deploys
    // before the embedding backfill has run).
    try {
      const all = await db
        .select({
          id: knowledgeEntries.id,
          kind: knowledgeEntries.kind,
          title: knowledgeEntries.title,
          body: knowledgeEntries.body,
          outcomeLabel: knowledgeEntries.outcomeLabel,
        })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.organizationId, organizationId))
        .limit(200);

      const tokens = Array.from(
        new Set(
          composed
            .toLowerCase()
            .match(/[a-z0-9]{3,}/g)
            ?.filter((t) => !STOPWORDS.has(t)) ?? [],
        ),
      );
      if (tokens.length > 0) {
        entryRows = all
          .map((e) => ({
            id: e.id,
            kind: e.kind as BrainEntryKind,
            title: e.title,
            body: e.body,
            outcome_label: e.outcomeLabel,
            similarity: scoreOverlap((e.title + " " + e.body).toLowerCase(), tokens),
          }))
          .filter((e) => Number(e.similarity) > 0)
          .sort((a, b) => Number(b.similarity) - Number(a.similarity))
          .slice(0, entryLimit);
      }
    } catch (err) {
      log.warn("[searchBrain]", "entry overlap query failed", { error: err });
    }
  }

  const hits: BrainHit[] = [
    ...corpusRows.map<BrainHit>((r) => ({
      source: "corpus",
      id: r.chunk_id,
      artifactId: r.artifact_id,
      artifactTitle: r.artifact_title,
      artifactKind: r.artifact_kind,
      outcomeLabel: (r.artifact_outcome ?? "none") as BrainOutcomeLabel,
      title: r.artifact_title || "(untitled artifact)",
      content: r.content,
      similarity: Number(r.similarity) + outcomeBoost(r.artifact_outcome),
    })),
    ...entryRows.map<BrainHit>((r) => ({
      source: "entry",
      id: r.id,
      entryKind: r.kind,
      outcomeLabel: (r.outcome_label ?? "none") as BrainOutcomeLabel,
      title: r.title,
      content: r.body,
      similarity: Number(r.similarity) + 0.05 + outcomeBoost(r.outcome_label),
    })),
  ]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, take);

  return { ok: true, hits, provider, stubbed };
}

function scoreOverlap(haystack: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let matched = 0;
  for (const t of tokens) if (haystack.includes(t)) matched += 1;
  return matched / tokens.length;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "are", "was", "were", "from",
  "into", "they", "their", "have", "has", "had", "but", "not", "you", "your",
  "our", "any", "all", "each", "such", "shall", "will", "may", "include",
  "including", "section", "agency", "naics", "proposal", "rfp",
]);
