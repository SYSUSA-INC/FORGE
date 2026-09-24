/**
 * BL-AIP-1 — which knowledge entries the capability matrix scores against.
 *
 * The matrix prompt shows at most 60 entries. Until now the action sent
 * the org's entries ALPHABETICALLY BY TITLE and the prompt kept the first
 * 60, so for any Brain larger than that the scores were arbitrary: the
 * entry that proves a requirement might start with "W". The Brain's own
 * retrieval (`searchBrain`, cosine similarity with the won/lost outcome
 * boost) already exists and is used by the section drafter; the matrix
 * now uses it too.
 *
 * Behaviour is unchanged for corpora that fit in the window (everything
 * is sent, alphabetically, exactly as before). Above the window the
 * Brain-ranked entries lead and the rest fill alphabetically; if the
 * embedding provider is stubbed or fails, the alphabetical list is used
 * so the matrix still runs.
 */
import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries } from "@/db/schema";
import { searchBrain } from "@/lib/brain-retrieval";
import { log } from "@/lib/log";

export type MatrixKnowledgeEntry = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
};

export type MatrixKnowledgeSelection = {
  entries: MatrixKnowledgeEntry[];
  /** True when the Brain ranked the leading entries. */
  ranked: boolean;
  totalEntries: number;
};

/** Mirrors the prompt's window (ai-prompts-bl23.ts keeps the first 60). */
export const MATRIX_KNOWLEDGE_LIMIT = 60;

export async function selectKnowledgeForMatrix(input: {
  organizationId: string;
  /** Solicitation title, agency, set-aside and requirement texts. */
  query: string;
  limit?: number;
}): Promise<MatrixKnowledgeSelection> {
  const limit = input.limit ?? MATRIX_KNOWLEDGE_LIMIT;

  const all: MatrixKnowledgeEntry[] = await db
    .select({
      id: knowledgeEntries.id,
      kind: knowledgeEntries.kind,
      title: knowledgeEntries.title,
      body: knowledgeEntries.body,
      tags: knowledgeEntries.tags,
    })
    .from(knowledgeEntries)
    .where(eq(knowledgeEntries.organizationId, input.organizationId))
    .orderBy(asc(knowledgeEntries.title));

  if (all.length <= limit) {
    return { entries: all, ranked: false, totalEntries: all.length };
  }

  let rankedIds: string[] = [];
  try {
    const res = await searchBrain({
      organizationId: input.organizationId,
      query: input.query,
      corpusLimit: 0,
      entryLimit: limit,
      take: limit,
    });
    if (res.ok && !res.stubbed) {
      rankedIds = res.hits.filter((h) => h.source === "entry").map((h) => h.id);
    }
  } catch (err) {
    log.warn("[matrix-knowledge]", "brain ranking failed; using alphabetical order", {
      error: err,
    });
  }

  if (rankedIds.length === 0) {
    return { entries: all.slice(0, limit), ranked: false, totalEntries: all.length };
  }

  const byId = new Map(all.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const picked: MatrixKnowledgeEntry[] = [];
  for (const id of rankedIds) {
    const e = byId.get(id);
    if (!e || seen.has(id)) continue;
    seen.add(id);
    picked.push(e);
    if (picked.length >= limit) break;
  }
  for (const e of all) {
    if (picked.length >= limit) break;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    picked.push(e);
  }
  return { entries: picked, ranked: true, totalEntries: all.length };
}
