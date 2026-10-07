/**
 * BL-AIX Phase 1g-2 — the queue of submitted Message Batches and the
 * collector that reads them.
 *
 * `queueAiBatch` submits one tenant's requests and stores the batch.
 * `collectAiBatches` runs from the jobs cron every five minutes: it asks
 * the provider where each open batch stands, claims an ended one (so two
 * ticks never read it twice), logs and meters every outcome like a live
 * call, and hands each validated result to the feature's handler under
 * the batch's own organization. A request that failed, expired or came
 * back unusable goes to the handler's `fail` (refund, clear the marker).
 * A batch the provider still has not finished 26 hours on is given up.
 *
 * Cross-org by design in the collector only: it is a background worker,
 * and every write it makes is scoped to the batch's organization.
 */
import "server-only";

import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { aiBatches, type AiBatch } from "@/db/schema";
import { batchResults, batchStatus, recordBatchOutcome, submitTenantBatch, type BatchRequest } from "@/lib/ai-batch";
import { batchGivenUp, type BatchResultLine } from "@/lib/ai-batch-logic";
import { log } from "@/lib/log";

/** Features whose work can run as a batch. */
export type BatchedFeature = "opportunity_triage";

export type BatchHandler<T> = {
  schema: z.ZodType<T>;
  /** Apply one validated result; false when it cannot be used (then `fail` runs). */
  apply(input: { organizationId: string; batchId: string; customId: string; data: T; model: string; promptVersion: string }): Promise<boolean>;
  /** A request that produced nothing usable. */
  fail(input: { organizationId: string; batchId: string; customId: string; reason: string }): Promise<void>;
  /** After every request in the batch has been read. */
  finish?(input: { organizationId: string; batchId: string; context: Record<string, unknown> }): Promise<void>;
};

async function handlerFor(feature: string): Promise<BatchHandler<unknown> | null> {
  switch (feature) {
    case "opportunity_triage":
      // Loaded on demand: the scout imports this module to queue its batch.
      return (await import("@/lib/scout")).scoutTriageBatchHandler as BatchHandler<unknown>;
    default:
      return null;
  }
}

/** Submit one tenant's requests as a batch and store it. Throws when the submit fails. */
export async function queueAiBatch(input: {
  organizationId: string;
  feature: BatchedFeature;
  promptVersion: string;
  context: Record<string, unknown>;
  requests: BatchRequest[];
}): Promise<{ batchId: string }> {
  const submitted = await submitTenantBatch({
    organizationId: input.organizationId,
    feature: input.feature,
    promptVersion: input.promptVersion,
    requests: input.requests,
  });
  const [row] = await db
    .insert(aiBatches)
    .values({
      organizationId: input.organizationId,
      feature: input.feature,
      promptVersion: input.promptVersion,
      externalId: submitted.externalId,
      requests: submitted.requests,
      context: input.context,
    })
    .returning({ id: aiBatches.id });
  if (!row) throw new Error("The batch was submitted but could not be stored.");
  return { batchId: row.id };
}

export type AiBatchCollectSummary = {
  checked: number;
  pending: number;
  processed: number;
  givenUp: number;
  succeeded: number;
  failed: number;
};

/** A claim older than this belongs to an instance that died mid-read. */
const PROCESSING_STALE_MS = 15 * 60_000;

export async function collectAiBatches(opts: { maxBatches?: number; budgetMs?: number; now?: Date } = {}): Promise<AiBatchCollectSummary> {
  const maxBatches = opts.maxBatches ?? 20;
  const budgetMs = opts.budgetMs ?? 60_000;
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  const summary: AiBatchCollectSummary = { checked: 0, pending: 0, processed: 0, givenUp: 0, succeeded: 0, failed: 0 };

  // A claim whose instance died: back in the queue.
  const stale = await db
    .select({ id: aiBatches.id, organizationId: aiBatches.organizationId })
    .from(aiBatches)
    .where(and(eq(aiBatches.status, "processing"), lt(aiBatches.checkedAt, new Date(now.getTime() - PROCESSING_STALE_MS))));
  for (const row of stale) {
    await db
      .update(aiBatches)
      .set({ status: "submitted" })
      .where(and(eq(aiBatches.id, row.id), eq(aiBatches.organizationId, row.organizationId), eq(aiBatches.status, "processing")));
  }

  const open = await db
    .select()
    .from(aiBatches)
    .where(eq(aiBatches.status, "submitted"))
    .orderBy(sql`${aiBatches.checkedAt} asc nulls first`, asc(aiBatches.submittedAt))
    .limit(maxBatches);

  for (const batch of open) {
    if (Date.now() - startedAt > budgetMs) break;
    summary.checked += 1;
    const giveUp = batchGivenUp(batch.submittedAt, now);
    let state: { ended: boolean; resultsUrl: string | null };
    try {
      state = await batchStatus(batch.externalId);
    } catch (err) {
      log.warn("[ai-batch]", "status check failed", { batchId: batch.id, organizationId: batch.organizationId, error: err });
      if (giveUp) {
        await giveUpOn(batch, `The provider could not report on the batch: ${err instanceof Error ? err.message : String(err)}`, now, summary);
      } else {
        await touch(batch, now);
      }
      continue;
    }
    if (!state.ended || !state.resultsUrl) {
      if (giveUp) await giveUpOn(batch, "The batch did not finish within 26 hours.", now, summary);
      else {
        await touch(batch, now);
        summary.pending += 1;
      }
      continue;
    }
    if (!(await claim(batch, now))) continue;
    let lines: Map<string, BatchResultLine>;
    try {
      lines = await batchResults(state.resultsUrl);
    } catch (err) {
      log.warn("[ai-batch]", "results read failed", { batchId: batch.id, organizationId: batch.organizationId, error: err });
      await db
        .update(aiBatches)
        .set({ status: "submitted" })
        .where(and(eq(aiBatches.id, batch.id), eq(aiBatches.organizationId, batch.organizationId)));
      continue;
    }
    await processBatch(batch, (customId) => lines.get(customId), now, summary);
    summary.processed += 1;
  }
  return summary;
}

async function touch(batch: AiBatch, now: Date): Promise<void> {
  await db
    .update(aiBatches)
    .set({ checkedAt: now })
    .where(and(eq(aiBatches.id, batch.id), eq(aiBatches.organizationId, batch.organizationId)));
}

async function claim(batch: AiBatch, now: Date): Promise<boolean> {
  const claimed = await db
    .update(aiBatches)
    .set({ status: "processing", checkedAt: now })
    .where(and(eq(aiBatches.id, batch.id), eq(aiBatches.organizationId, batch.organizationId), eq(aiBatches.status, "submitted")))
    .returning({ id: aiBatches.id });
  return claimed.length > 0;
}

async function giveUpOn(batch: AiBatch, reason: string, now: Date, summary: AiBatchCollectSummary): Promise<void> {
  if (!(await claim(batch, now))) return;
  await processBatch(batch, (customId) => ({ customId, type: "errored", error: reason }), now, summary, reason);
  summary.givenUp += 1;
}

/** Log, meter and apply every request of a claimed batch, then close it. */
async function processBatch(
  batch: AiBatch,
  lineFor: (customId: string) => BatchResultLine | undefined,
  now: Date,
  summary: AiBatchCollectSummary,
  failure?: string,
): Promise<void> {
  const organizationId = batch.organizationId;
  const handler = await handlerFor(batch.feature);
  let succeeded = 0;
  let failed = 0;
  for (const meta of batch.requests) {
    try {
      const outcome = await recordBatchOutcome({
        organizationId,
        feature: batch.feature as BatchedFeature,
        promptVersion: batch.promptVersion,
        meta,
        line: lineFor(meta.customId),
        schema: handler?.schema,
      });
      const data = outcome.validation?.data;
      const applied =
        handler && outcome.result && data !== null && data !== undefined
          ? await handler.apply({ organizationId, batchId: batch.id, customId: meta.customId, data, model: outcome.result.model, promptVersion: batch.promptVersion })
          : false;
      if (applied) {
        succeeded += 1;
      } else {
        failed += 1;
        await handler?.fail({ organizationId, batchId: batch.id, customId: meta.customId, reason: outcome.error ?? "The answer could not be used." });
      }
    } catch (err) {
      failed += 1;
      log.error("[ai-batch]", "request outcome failed", { batchId: batch.id, organizationId, customId: meta.customId, error: err });
    }
  }
  try {
    await handler?.finish?.({ organizationId, batchId: batch.id, context: batch.context });
  } catch (err) {
    log.warn("[ai-batch]", "finish failed", { batchId: batch.id, organizationId, error: err });
  }
  await db
    .update(aiBatches)
    .set({ status: failure ? "failed" : "processed", succeeded, failed, error: failure ?? (handler ? null : `No handler for ${batch.feature}.`), processedAt: now })
    .where(and(eq(aiBatches.id, batch.id), eq(aiBatches.organizationId, organizationId)));
  summary.succeeded += succeeded;
  summary.failed += failed;
}
