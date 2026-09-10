/**
 * BL-AI-TELEMETRY — per-call AI ledger writer + readers.
 *
 * `recordAiCall` is invoked from inside `completeForTenant` for every
 * outcome (ok / error / quota_refused). It is strictly best-effort: a
 * telemetry failure must never fail, slow, or change the AI call, so it
 * swallows and logs.
 *
 * Readers are platform-wide (superadmin usage page) with an optional
 * organization filter so a tenant-facing view can reuse them later.
 *
 * Cross-org reads/deletes here are intentional — this file is a
 * server-only lib, not a "use server" action. The isolation checker
 * exempts it for the same reason it exempts the audit-log pruner.
 */
import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiCallLogs, type AiCallStatus } from "@/db/schema";
import { log } from "@/lib/log";

export type AiCallRecord = {
  organizationId: string;
  feature: string;
  variant?: string;
  promptVersion?: string;
  provider?: string;
  model?: string;
  requestedModel?: string;
  status: AiCallStatus;
  error?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  outputChars?: number;
  maxTokens?: number | null;
  latencyMs: number;
  stubbed?: boolean;
  cacheSystem?: boolean;
  hasDocuments?: boolean;
};

const ERROR_CAP = 500;

/** Best-effort insert. Never throws. */
export async function recordAiCall(rec: AiCallRecord): Promise<void> {
  try {
    await db.insert(aiCallLogs).values({
      organizationId: rec.organizationId,
      feature: rec.feature,
      variant: rec.variant ?? "",
      promptVersion: rec.promptVersion ?? "",
      provider: rec.provider ?? "",
      model: rec.model ?? "",
      requestedModel: rec.requestedModel ?? "",
      status: rec.status,
      error: rec.error ? rec.error.slice(0, ERROR_CAP) : null,
      inputTokens: rec.inputTokens ?? 0,
      outputTokens: rec.outputTokens ?? 0,
      outputChars: rec.outputChars ?? 0,
      maxTokens: rec.maxTokens ?? null,
      latencyMs: Math.max(0, Math.round(rec.latencyMs)),
      stubbed: rec.stubbed ?? false,
      cacheSystem: rec.cacheSystem ?? false,
      hasDocuments: rec.hasDocuments ?? false,
    });
  } catch (err) {
    log.warn("[ai-telemetry]", "record failed", {
      feature: rec.feature,
      status: rec.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type AiFeatureBreakdownRow = {
  feature: string;
  calls: number;
  ok: number;
  errors: number;
  quotaRefused: number;
  stubbed: number;
  inputTokens: number;
  outputTokens: number;
  /** Mean provider latency over ok calls, ms. */
  avgLatencyMs: number;
  maxLatencyMs: number;
  tenants: number;
};

/**
 * Aggregate calls by feature since `since`. Ordered by total tokens
 * descending so the most expensive surfaces surface first. Pass
 * `organizationId` to scope to one tenant.
 */
export async function getAiFeatureBreakdown(
  since: Date,
  organizationId?: string,
): Promise<AiFeatureBreakdownRow[]> {
  const where = organizationId
    ? and(gte(aiCallLogs.createdAt, since), eq(aiCallLogs.organizationId, organizationId))
    : gte(aiCallLogs.createdAt, since);

  const rows = await db
    .select({
      feature: aiCallLogs.feature,
      calls: sql<string>`count(*)`,
      ok: sql<string>`count(*) filter (where ${aiCallLogs.status} = 'ok')`,
      errors: sql<string>`count(*) filter (where ${aiCallLogs.status} = 'error')`,
      quotaRefused: sql<string>`count(*) filter (where ${aiCallLogs.status} = 'quota_refused')`,
      stubbed: sql<string>`count(*) filter (where ${aiCallLogs.stubbed})`,
      inputTokens: sql<string>`coalesce(sum(${aiCallLogs.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${aiCallLogs.outputTokens}), 0)`,
      avgLatencyMs: sql<string>`coalesce(avg(${aiCallLogs.latencyMs}) filter (where ${aiCallLogs.status} = 'ok'), 0)`,
      maxLatencyMs: sql<string>`coalesce(max(${aiCallLogs.latencyMs}), 0)`,
      tenants: sql<string>`count(distinct ${aiCallLogs.organizationId})`,
    })
    .from(aiCallLogs)
    .where(where)
    .groupBy(aiCallLogs.feature)
    .orderBy(
      sql`sum(${aiCallLogs.inputTokens} + ${aiCallLogs.outputTokens}) desc`,
    );

  // Postgres returns bigint / numeric aggregates as strings over the
  // wire; normalize to numbers once here.
  return rows.map((r) => ({
    feature: r.feature,
    calls: Number(r.calls),
    ok: Number(r.ok),
    errors: Number(r.errors),
    quotaRefused: Number(r.quotaRefused),
    stubbed: Number(r.stubbed),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    avgLatencyMs: Math.round(Number(r.avgLatencyMs)),
    maxLatencyMs: Number(r.maxLatencyMs),
    tenants: Number(r.tenants),
  }));
}

const DEFAULT_RETENTION_DAYS = 90;

/** Effective retention window: env override, else 90 days. */
export function aiCallLogRetentionDays(): number {
  const env = Number(process.env.AI_CALL_LOG_RETENTION_DAYS || "");
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : DEFAULT_RETENTION_DAYS;
}

/**
 * Delete rows older than the retention window. Cross-tenant by design
 * (cron context). Returns the count so the cron can log it.
 */
export async function pruneAiCallLogs(
  retentionDays: number = aiCallLogRetentionDays(),
): Promise<{ rowsDeleted: number; retentionDays: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
  const deleted = await db
    .delete(aiCallLogs)
    .where(lt(aiCallLogs.createdAt, cutoff))
    .returning({ id: aiCallLogs.id });
  return { rowsDeleted: deleted.length, retentionDays };
}
