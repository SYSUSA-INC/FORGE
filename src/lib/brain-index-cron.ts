/**
 * BL-AIP-4 — the Brain's background indexer.
 *
 * Until now the knowledge base only learned when a person clicked:
 * uploads were embedded and mined on demand, stub vectors written before
 * an embedding key existed stayed forever, and outcome labels set after
 * a harvest never reached the harvested artifact. This cron closes those
 * loops on a schedule (vercel.json: every six hours):
 *
 *   1. Reconcile outcomes — harvested artifacts whose proposal has an
 *      outcome that differs from the artifact's label.
 *   2. Embed artifacts that have text but no chunks.
 *   3. Re-embed chunks and entries that carry stub / unknown vectors,
 *      once a live embedding provider is configured.
 *   4. Embed curated entries that have no vector.
 *   5. Auto-extract candidates from indexed artifacts that were never
 *      mined (feature- and quota-gated per tenant; skipped in stub mode).
 *
 * Cross-org by design: this is a background worker, not a user request
 * (same exemption as the other cron libs). Every write carries the row's
 * own organization_id. Budgets keep one run well inside the function's
 * time limit; anything left waits for the next tick.
 */
import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getAIProviderStatus } from "@/lib/ai";
import { liveEmbeddingProviderConfigured } from "@/lib/embeddings";
import { embedArtifact } from "@/lib/knowledge-artifact-embed";
import { embedKnowledgeEntries, type EntryEmbedRow } from "@/lib/knowledge-entry-embed";
import { runKnowledgeExtraction } from "@/lib/knowledge-extraction";
import { propagateOutcomeToCorpus } from "@/lib/knowledge-outcome";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";
import type { ProposalOutcomeType } from "@/db/schema";

export type BrainIndexSummary = {
  outcomesReconciled: number;
  artifactsEmbedded: number;
  artifactsReembedded: number;
  entriesEmbedded: number;
  extractionsRun: number;
  candidatesCreated: number;
  duplicatesSkipped: number;
  skippedGated: number;
  /** True when the AI provider is in stub mode and extraction was skipped. */
  extractionSkippedStub: boolean;
  liveEmbeddings: boolean;
  errors: number;
};

export type BrainIndexOptions = {
  maxEmbeds?: number;
  maxEntryEmbeds?: number;
  maxExtractions?: number;
};

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

export async function runBrainIndex(opts: BrainIndexOptions = {}): Promise<BrainIndexSummary> {
  const maxEmbeds = opts.maxEmbeds ?? 10;
  const maxEntryEmbeds = opts.maxEntryEmbeds ?? 200;
  const maxExtractions = opts.maxExtractions ?? 3;
  const live = liveEmbeddingProviderConfigured();

  const summary: BrainIndexSummary = {
    outcomesReconciled: 0,
    artifactsEmbedded: 0,
    artifactsReembedded: 0,
    entriesEmbedded: 0,
    extractionsRun: 0,
    candidatesCreated: 0,
    duplicatesSkipped: 0,
    skippedGated: 0,
    extractionSkippedStub: false,
    liveEmbeddings: live,
    errors: 0,
  };

  // 1. Outcome reconciliation.
  try {
    const stale = rowsOf<{
      organization_id: string;
      proposal_id: string;
      outcome_type: ProposalOutcomeType;
    }>(
      await db.execute(sql`
        SELECT DISTINCT a.organization_id, po.proposal_id, po.outcome_type
        FROM knowledge_artifact a
        JOIN proposal_outcome po
          ON po.organization_id = a.organization_id
         AND po.proposal_id::text = a.metadata ->> 'proposalId'
        WHERE a.source = 'mined_from_proposal'
          AND a.outcome_label::text <> po.outcome_type::text
        LIMIT 200
      `),
    );
    for (const row of stale) {
      try {
        const r = await propagateOutcomeToCorpus({
          organizationId: row.organization_id,
          proposalId: row.proposal_id,
          outcomeType: row.outcome_type,
        });
        summary.outcomesReconciled += r.artifactsTagged;
      } catch (err) {
        summary.errors += 1;
        log.error("[brain-index]", "outcome reconcile failed", { error: err, proposalId: row.proposal_id });
      }
    }
  } catch (err) {
    summary.errors += 1;
    log.error("[brain-index]", "outcome scan failed", { error: err });
  }

  // 2. Artifacts with text but no chunks.
  let embedBudget = maxEmbeds;
  try {
    const missing = rowsOf<{ id: string; organization_id: string }>(
      await db.execute(sql`
        SELECT a.id, a.organization_id
        FROM knowledge_artifact a
        WHERE a.status = 'indexed'
          AND a.archived_at IS NULL
          AND length(a.raw_text) > 0
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_artifact_chunk c
            WHERE c.artifact_id = a.id AND c.organization_id = a.organization_id
          )
        ORDER BY a.created_at DESC
        LIMIT ${embedBudget}
      `),
    );
    for (const row of missing) {
      const r = await embedArtifact({ organizationId: row.organization_id, artifactId: row.id });
      if (r.ok) summary.artifactsEmbedded += 1;
      else {
        summary.errors += 1;
        log.warn("[brain-index]", "embed failed", { artifactId: row.id, error: r.error });
      }
      embedBudget -= 1;
    }
  } catch (err) {
    summary.errors += 1;
    log.error("[brain-index]", "missing-chunk scan failed", { error: err });
  }

  // 3. Stub / unknown chunk vectors, once a live provider exists.
  if (live && embedBudget > 0) {
    try {
      const stale = rowsOf<{ artifact_id: string; organization_id: string }>(
        await db.execute(sql`
          SELECT DISTINCT c.artifact_id, c.organization_id
          FROM knowledge_artifact_chunk c
          JOIN knowledge_artifact a ON a.id = c.artifact_id AND a.organization_id = c.organization_id
          WHERE c.embedding_provider IN ('', 'stub')
            AND a.archived_at IS NULL
          LIMIT ${embedBudget}
        `),
      );
      for (const row of stale) {
        const r = await embedArtifact({ organizationId: row.organization_id, artifactId: row.artifact_id });
        if (r.ok) summary.artifactsReembedded += 1;
        else {
          summary.errors += 1;
          log.warn("[brain-index]", "re-embed failed", { artifactId: row.artifact_id, error: r.error });
        }
      }
    } catch (err) {
      summary.errors += 1;
      log.error("[brain-index]", "stale-chunk scan failed", { error: err });
    }
  }

  // 4. Entries with no vector (or stub vectors when live).
  try {
    const staleFilter = live
      ? sql`(e.embedding IS NULL OR e.embedding_provider IN ('', 'stub'))`
      : sql`e.embedding IS NULL`;
    const entries = rowsOf<{ id: string; organization_id: string; title: string; body: string }>(
      await db.execute(sql`
        SELECT e.id, e.organization_id, e.title, e.body
        FROM knowledge_entry e
        WHERE e.archived_at IS NULL
          AND ${staleFilter}
        ORDER BY e.updated_at DESC
        LIMIT ${maxEntryEmbeds}
      `),
    );
    const byOrg = new Map<string, EntryEmbedRow[]>();
    for (const e of entries) {
      const list = byOrg.get(e.organization_id) ?? [];
      list.push({ id: e.id, title: e.title, body: e.body });
      byOrg.set(e.organization_id, list);
    }
    for (const [organizationId, rows] of byOrg) {
      const r = await embedKnowledgeEntries(organizationId, rows);
      summary.entriesEmbedded += r.embedded;
    }
  } catch (err) {
    summary.errors += 1;
    log.error("[brain-index]", "entry embed scan failed", { error: err });
  }

  // 5. Auto-extract never-mined artifacts.
  if (getAIProviderStatus().active.name === "stub") {
    summary.extractionSkippedStub = true;
    return summary;
  }
  try {
    const unmined = rowsOf<{ id: string; organization_id: string }>(
      await db.execute(sql`
        SELECT a.id, a.organization_id
        FROM knowledge_artifact a
        WHERE a.status = 'indexed'
          AND a.archived_at IS NULL
          AND length(a.raw_text) > 0
          AND NOT EXISTS (
            SELECT 1 FROM knowledge_extraction_run r
            WHERE r.artifact_id = a.id AND r.organization_id = a.organization_id
          )
        ORDER BY a.created_at DESC
        LIMIT ${maxExtractions}
      `),
    );
    for (const row of unmined) {
      const organizationId = row.organization_id;
      try {
        await ensureFeature(organizationId, "aiAutoDraft");
        await enforceQuota(organizationId, "aiRequestsPerMonth");
      } catch (err) {
        if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
          summary.skippedGated += 1;
          continue;
        }
        throw err;
      }
      const r = await runKnowledgeExtraction({
        organizationId,
        artifactId: row.id,
        startedByUserId: null,
        skipStub: true,
      });
      if (r.ok) {
        summary.extractionsRun += 1;
        summary.candidatesCreated += r.candidateCount;
        summary.duplicatesSkipped += r.skippedDuplicates;
      } else {
        summary.errors += 1;
        await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
        log.warn("[brain-index]", "extraction failed", { artifactId: row.id, error: r.error });
      }
    }
  } catch (err) {
    summary.errors += 1;
    log.error("[brain-index]", "extraction scan failed", { error: err });
  }

  return summary;
}
