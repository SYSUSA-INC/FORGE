/**
 * BL-AIP-4c — durable background jobs.
 *
 * `runInBackground` (BL-AIP-4) keeps a Vercel instance alive until a
 * fire-and-forget parse or harvest settles, but a deploy, a timeout or
 * a crash mid-run still left the solicitation at "parsing" forever with
 * nothing to retry it, and a harvest that died stayed out of the Brain.
 * Every such run is now a `background_job` row:
 *
 *   request  → runDurable(): insert the row (or reuse an open one for
 *              the same resource), then start it at once in the
 *              background exactly as before — the user waits for
 *              nothing extra.
 *   cron     → runJobsCron() every five minutes: rows still `running`
 *              past the stuck window are presumed dead and re-queued
 *              (or failed once their attempts are spent); due `queued`
 *              rows are claimed and run from the stored file bytes.
 *
 * A claim is a conditional UPDATE (`status = 'queued'`), so two
 * instances can never run the same row. Handler exceptions back off
 * and retry up to `max_attempts`; a `JobPermanentError` (the file bytes
 * are gone, the row was deleted, the parser itself reported a failure)
 * fails the job at once with the reason on the row. Every read and
 * write carries the job's organization_id; the cron's sweep across
 * tenants is by design (same exemption as the other cron libs).
 */
import "server-only";

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  backgroundJobs,
  solicitationDocuments,
  solicitations,
  type BackgroundJob,
  type BackgroundJobKind,
} from "@/db/schema";
import { runInBackground } from "@/lib/background";
import {
  JOB_MAX_ATTEMPTS,
  JobPermanentError,
  jobIsStuck,
  nextJobAttempt,
  resolveStuckJob,
} from "@/lib/jobs-policy";
import { log } from "@/lib/log";
import { handleSectionAutoDraft } from "@/lib/auto-draft-job";
import { harvestProposal } from "@/lib/proposal-harvest";
import { parseSolicitationDocumentFromBytes } from "@/lib/solicitation-document-parse";
import { parseSolicitationFromBytes } from "@/lib/solicitation-parse";
import { getStorageProvider } from "@/lib/storage";

export { JobPermanentError };

export const BYTES_GONE_ERROR =
  "File bytes are no longer in storage — re-upload the document. (Memory storage doesn't survive redeploys.)";

export type JobSpec = {
  organizationId: string;
  kind: BackgroundJobKind;
  /** The solicitation / companion document / proposal the job acts on. */
  resourceId: string;
  payload?: Record<string, unknown>;
  requestedByUserId?: string | null;
  maxAttempts?: number;
};

export type JobContext = {
  /** First attempt from an upload: the bytes are already in memory. */
  bytes?: Uint8Array;
  viaCron: boolean;
};

export type JobRunResult =
  | { ran: false; reason: "not_claimable" }
  | { ran: true; ok: true }
  | { ran: true; ok: false; error: string; retryScheduled: boolean };

export type JobsCronSummary = {
  /** Stuck `running` rows re-queued for another attempt. */
  recovered: number;
  /** Stuck rows failed because their attempts were spent. */
  abandoned: number;
  ran: number;
  succeeded: number;
  retried: number;
  failed: number;
  /** Due rows left for the next tick (batch cap or time budget). */
  deferred: number;
};

/**
 * Insert a job row, or return the open (queued / running) row that
 * already exists for the same resource so a double click or a re-parse
 * during a parse never runs the same work twice.
 */
export async function enqueueJob(
  spec: JobSpec,
): Promise<{ job: BackgroundJob; reused: boolean }> {
  const { organizationId } = spec;
  const [open] = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.organizationId, organizationId),
        eq(backgroundJobs.kind, spec.kind),
        eq(backgroundJobs.resourceId, spec.resourceId),
        inArray(backgroundJobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (open) return { job: open, reused: true };

  const [job] = await db
    .insert(backgroundJobs)
    .values({
      organizationId,
      kind: spec.kind,
      resourceId: spec.resourceId,
      payload: spec.payload ?? {},
      requestedByUserId: spec.requestedByUserId ?? null,
      maxAttempts: spec.maxAttempts ?? JOB_MAX_ATTEMPTS,
    })
    .returning();
  if (!job) throw new Error("Could not create background job.");
  return { job, reused: false };
}

/**
 * The durable replacement for `runInBackground(label, work)` on parses
 * and harvests: record the row, then run it now without blocking the
 * response. Returns the row so callers can surface its id.
 */
export async function runDurable(
  label: string,
  spec: JobSpec,
  ctx: { bytes?: Uint8Array } = {},
): Promise<{ jobId: string; reused: boolean }> {
  const { organizationId } = spec;
  const { job, reused } = await enqueueJob(spec);
  if (job.status === "queued") {
    runInBackground(label, () =>
      executeJob(job.id, organizationId, { bytes: ctx.bytes, viaCron: false }),
    );
  }
  return { jobId: job.id, reused };
}

/**
 * Claim a queued row and run its handler. Safe to call from two places
 * at once: only the caller whose conditional UPDATE lands runs it.
 */
export async function executeJob(
  jobId: string,
  organizationId: string,
  ctx: JobContext,
): Promise<JobRunResult> {
  const now = new Date();
  const [claimed] = await db
    .update(backgroundJobs)
    .set({
      status: "running",
      attempts: sql`${backgroundJobs.attempts} + 1`,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(backgroundJobs.id, jobId),
        eq(backgroundJobs.organizationId, organizationId),
        eq(backgroundJobs.status, "queued"),
      ),
    )
    .returning();
  if (!claimed) return { ran: false, reason: "not_claimable" };

  const label = `[jobs:${claimed.kind}]`;
  try {
    await HANDLERS[claimed.kind](claimed, ctx);
    const done = new Date();
    await db
      .update(backgroundJobs)
      .set({ status: "done", error: "", finishedAt: done, updatedAt: done })
      .where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.organizationId, organizationId)));
    return { ran: true, ok: true };
  } catch (err) {
    const permanent = err instanceof JobPermanentError;
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const failedAt = new Date();
    const next = permanent
      ? { giveUp: true as const, nextAttemptAt: null }
      : nextJobAttempt(claimed.attempts, claimed.maxAttempts, failedAt);
    await db
      .update(backgroundJobs)
      .set({
        status: next.giveUp ? "failed" : "queued",
        error: message,
        nextAttemptAt: next.nextAttemptAt ?? failedAt,
        finishedAt: next.giveUp ? failedAt : null,
        updatedAt: failedAt,
      })
      .where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.organizationId, organizationId)));
    (next.giveUp ? log.error : log.warn)(label, "job failed", {
      jobId,
      organizationId,
      resourceId: claimed.resourceId,
      attempt: claimed.attempts,
      permanent,
      retryScheduled: !next.giveUp,
      error: message,
    });
    return { ran: true, ok: false, error: message, retryScheduled: !next.giveUp };
  }
}

/**
 * The cron tick: recover stuck rows, then run due rows oldest-first
 * inside a time budget so one long parse cannot push the function past
 * its limit and become the next stuck row.
 */
export async function runJobsCron(opts: {
  maxJobs?: number;
  budgetMs?: number;
  now?: Date;
} = {}): Promise<JobsCronSummary> {
  const maxJobs = opts.maxJobs ?? 3;
  const budgetMs = opts.budgetMs ?? 200_000;
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  const summary: JobsCronSummary = {
    recovered: 0,
    abandoned: 0,
    ran: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
  };

  // 1. Stuck rows: still `running` past the window → presumed dead.
  const running = await db
    .select({
      id: backgroundJobs.id,
      organizationId: backgroundJobs.organizationId,
      attempts: backgroundJobs.attempts,
      maxAttempts: backgroundJobs.maxAttempts,
      startedAt: backgroundJobs.startedAt,
      error: backgroundJobs.error,
    })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, "running"))
    .limit(100);
  for (const row of running) {
    if (!jobIsStuck(row.startedAt, now)) continue;
    const resolution = resolveStuckJob(row.attempts, row.maxAttempts);
    const note = `Run died with its instance after attempt ${row.attempts} (recovered by the jobs cron).`;
    await db
      .update(backgroundJobs)
      .set({
        status: resolution,
        error: note,
        nextAttemptAt: now,
        finishedAt: resolution === "failed" ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(backgroundJobs.id, row.id),
          eq(backgroundJobs.organizationId, row.organizationId),
          eq(backgroundJobs.status, "running"),
        ),
      );
    if (resolution === "queued") summary.recovered += 1;
    else summary.abandoned += 1;
  }

  // 2. Due rows, oldest first.
  const due = await db
    .select({ id: backgroundJobs.id, organizationId: backgroundJobs.organizationId })
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.status, "queued"), lte(backgroundJobs.nextAttemptAt, now)))
    .orderBy(asc(backgroundJobs.nextAttemptAt), asc(backgroundJobs.createdAt))
    .limit(maxJobs + 1);
  for (let i = 0; i < due.length; i++) {
    const row = due[i]!;
    if (i >= maxJobs || Date.now() - startedAt > budgetMs) {
      summary.deferred += due.length - i;
      break;
    }
    const res = await executeJob(row.id, row.organizationId, { viaCron: true });
    if (!res.ran) continue;
    summary.ran += 1;
    if (res.ok) summary.succeeded += 1;
    else if (res.retryScheduled) summary.retried += 1;
    else summary.failed += 1;
  }

  return summary;
}

/** The newest job for a resource, for the tenant-facing status line. */
export async function latestJobForResource(input: {
  organizationId: string;
  kind: BackgroundJobKind;
  resourceId: string;
}): Promise<BackgroundJob | null> {
  const { organizationId } = input;
  const [row] = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.organizationId, organizationId),
        eq(backgroundJobs.kind, input.kind),
        eq(backgroundJobs.resourceId, input.resourceId),
      ),
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(1);
  return row ?? null;
}

// ── handlers ──────────────────────────────────────────────────────────

type Handler = (job: BackgroundJob, ctx: JobContext) => Promise<void>;

const HANDLERS: Record<BackgroundJobKind, Handler> = {
  solicitation_parse: handleSolicitationParse,
  solicitation_document_parse: handleSolicitationDocumentParse,
  proposal_harvest: handleProposalHarvest,
  section_auto_draft: handleSectionAutoDraft,
};

async function loadBytes(
  storagePath: string,
  inline: Uint8Array | undefined,
): Promise<Uint8Array | null> {
  if (inline) return inline;
  if (!storagePath) return null;
  const obj = await getStorageProvider().get(storagePath);
  return obj?.bytes ?? null;
}

async function handleSolicitationParse(job: BackgroundJob, ctx: JobContext): Promise<void> {
  const organizationId = job.organizationId;
  const [row] = await db
    .select({ id: solicitations.id, storagePath: solicitations.storagePath })
    .from(solicitations)
    .where(and(eq(solicitations.id, job.resourceId), eq(solicitations.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new JobPermanentError("Solicitation no longer exists.");

  const bytes = await loadBytes(row.storagePath, ctx.bytes);
  if (!bytes) {
    await db
      .update(solicitations)
      .set({ parseStatus: "failed", parseError: BYTES_GONE_ERROR, updatedAt: new Date() })
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, row.id)));
    throw new JobPermanentError(BYTES_GONE_ERROR);
  }

  await parseSolicitationFromBytes(row.id, organizationId, bytes);

  // The parser records its own outcome on the row; a reported failure
  // (unreadable file, AI refusal) is final for this job — the row shows
  // the reason and Re-parse enqueues a fresh one.
  const [after] = await db
    .select({ parseStatus: solicitations.parseStatus, parseError: solicitations.parseError })
    .from(solicitations)
    .where(and(eq(solicitations.id, row.id), eq(solicitations.organizationId, organizationId)))
    .limit(1);
  if (after?.parseStatus === "failed") {
    throw new JobPermanentError(after.parseError || "Parse failed.");
  }
}

async function handleSolicitationDocumentParse(job: BackgroundJob, ctx: JobContext): Promise<void> {
  const organizationId = job.organizationId;
  const [row] = await db
    .select({
      id: solicitationDocuments.id,
      solicitationId: solicitationDocuments.solicitationId,
      storagePath: solicitationDocuments.storagePath,
      fileName: solicitationDocuments.fileName,
      contentType: solicitationDocuments.contentType,
    })
    .from(solicitationDocuments)
    .where(
      and(
        eq(solicitationDocuments.id, job.resourceId),
        eq(solicitationDocuments.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new JobPermanentError("Document no longer exists.");

  const bytes = await loadBytes(row.storagePath, ctx.bytes);
  if (!bytes) {
    await db
      .update(solicitationDocuments)
      .set({ parseStatus: "failed", parseError: BYTES_GONE_ERROR, updatedAt: new Date() })
      .where(and(eq(solicitationDocuments.organizationId, organizationId), eq(solicitationDocuments.id, row.id)));
    throw new JobPermanentError(BYTES_GONE_ERROR);
  }

  await parseSolicitationDocumentFromBytes(
    row.id,
    row.solicitationId,
    organizationId,
    bytes,
    row.fileName,
    row.contentType,
  );

  const [after] = await db
    .select({ parseStatus: solicitationDocuments.parseStatus, parseError: solicitationDocuments.parseError })
    .from(solicitationDocuments)
    .where(and(eq(solicitationDocuments.id, row.id), eq(solicitationDocuments.organizationId, organizationId)))
    .limit(1);
  if (after?.parseStatus === "failed") {
    throw new JobPermanentError(after.parseError || "Parse failed.");
  }
}

async function handleProposalHarvest(job: BackgroundJob): Promise<void> {
  const organizationId = job.organizationId;
  const res = await harvestProposal({
    organizationId,
    proposalId: job.resourceId,
    actor: { userId: job.requestedByUserId },
  });
  if (!res.ok) throw new JobPermanentError(res.error);
}
