"use server";

/**
 * BL-15 Phase B-3c — runtime isolation status check.
 *
 * Two actions:
 *   - `runIsolationCheckAction(organizationId)` — superadmin-only.
 *     Picks any other tenant as a phantom attacker, samples a few
 *     row ids from three representative tenant-scoped tables
 *     (opportunities, proposals, knowledge_artifacts) for that
 *     attacker, then runs SELECT queries that filter by
 *     (id IN attackerRows AND organization_id = target). Isolated
 *     tenants return zero rows for every probe; a non-zero return
 *     is a real isolation leak and the result row's `failed_checks`
 *     count will be > 0.
 *   - `listIsolationCheckResultsAction(organizationId)` — read the
 *     last 25 results for the operator UI.
 *
 * The check is intentionally cheap and idempotent: it does only
 * SELECTs (no writes to the data tables themselves) and produces
 * exactly one row in `isolation_check_result` per call. Safe to
 * run repeatedly; safe to wire into a future cron.
 */

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  isolationCheckResults,
  knowledgeArtifacts,
  opportunities,
  organizations,
  proposals,
  type IsolationCheckProbeDetail,
  type IsolationCheckResult,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

const SAMPLE_ATTACKER_ROW_LIMIT = 10;

type ProbeTableConfig = {
  name: string;
  table:
    | typeof opportunities
    | typeof proposals
    | typeof knowledgeArtifacts;
};

const PROBE_TABLES: ProbeTableConfig[] = [
  { name: "opportunities", table: opportunities },
  { name: "proposals", table: proposals },
  { name: "knowledge_artifacts", table: knowledgeArtifacts },
];

export type IsolationCheckSummary = {
  id: string;
  triggeredAt: string;
  triggeredByUserId: string | null;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  skippedChecks: number;
  details: IsolationCheckProbeDetail[];
  notes: string;
};

function toSummary(row: IsolationCheckResult): IsolationCheckSummary {
  return {
    id: row.id,
    triggeredAt: row.triggeredAt.toISOString(),
    triggeredByUserId: row.triggeredByUserId,
    totalChecks: row.totalChecks,
    passedChecks: row.passedChecks,
    failedChecks: row.failedChecks,
    skippedChecks: row.skippedChecks,
    details: row.details,
    notes: row.notes,
  };
}

/** Pick any organization that isn't the target — used as the phantom attacker. */
async function pickAttackerOrgId(targetOrgId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(ne(organizations.id, targetOrgId))
    .limit(1);
  return row?.id ?? null;
}

async function probeTable(opts: {
  config: ProbeTableConfig;
  targetOrgId: string;
  attackerOrgId: string;
}): Promise<IsolationCheckProbeDetail> {
  const { config, targetOrgId, attackerOrgId } = opts;
  // The `unknown` cast is needed because the three tables don't share
  // a precise Drizzle column type at the TS level, but they DO all
  // have `id` and `organizationId` columns by schema convention.
  const t = config.table as unknown as {
    id: typeof opportunities.id;
    organizationId: typeof opportunities.organizationId;
  };
  const attackerRows = await db
    .select({ id: t.id })
    .from(config.table)
    .where(eq(t.organizationId, attackerOrgId))
    .limit(SAMPLE_ATTACKER_ROW_LIMIT);

  if (attackerRows.length === 0) {
    return {
      table: config.name,
      status: "skipped",
      attackerOrganizationId: attackerOrgId,
      reason: "attacker tenant has no rows in this table",
    };
  }

  const attackerIds = attackerRows.map((r) => r.id);
  const leaked = await db
    .select({ id: t.id })
    .from(config.table)
    .where(and(inArray(t.id, attackerIds), eq(t.organizationId, targetOrgId)));

  return {
    table: config.name,
    status: leaked.length === 0 ? "pass" : "fail",
    attackerOrganizationId: attackerOrgId,
    attackerRowIdsSampled: attackerIds.length,
    rowsLeaked: leaked.length,
  };
}

export async function runIsolationCheckAction(input: {
  organizationId: string;
}): Promise<
  | { ok: true; result: IsolationCheckSummary }
  | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Organization not found." };

  const attackerOrgId = await pickAttackerOrgId(input.organizationId);

  const details: IsolationCheckProbeDetail[] = [];
  let notes = "";

  if (!attackerOrgId) {
    // Single-tenant environment — there's nothing to compare against.
    // Record an empty result so the operator still sees a row, but
    // mark every probe as skipped with a clear reason.
    notes = "Only one tenant in this database — no cross-tenant probes possible.";
    for (const config of PROBE_TABLES) {
      details.push({
        table: config.name,
        status: "skipped",
        reason: "no other tenant exists in this database",
      });
    }
  } else {
    for (const config of PROBE_TABLES) {
      try {
        details.push(
          await probeTable({
            config,
            targetOrgId: input.organizationId,
            attackerOrgId,
          }),
        );
      } catch (err) {
        log.warn("[runIsolationCheckAction]", "probe failed", {
          table: config.name,
          error: err,
        });
        details.push({
          table: config.name,
          status: "skipped",
          reason: err instanceof Error ? err.message : "probe threw",
        });
      }
    }
  }

  const summary = {
    total: details.length,
    pass: details.filter((d) => d.status === "pass").length,
    fail: details.filter((d) => d.status === "fail").length,
    skipped: details.filter((d) => d.status === "skipped").length,
  };

  try {
    const [row] = await db
      .insert(isolationCheckResults)
      .values({
        organizationId: input.organizationId,
        triggeredByUserId: actor.id,
        totalChecks: summary.total,
        passedChecks: summary.pass,
        failedChecks: summary.fail,
        skippedChecks: summary.skipped,
        details,
        notes,
      })
      .returning();
    if (!row) return { ok: false, error: "Result insert failed." };

    await recordAudit({
      organizationId: input.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action:
        summary.fail > 0
          ? "superadmin.isolation_check_failed"
          : "superadmin.isolation_check_passed",
      resourceType: "organization",
      resourceId: input.organizationId,
      metadata: {
        viaSuperadmin: true,
        resultId: row.id,
        totalChecks: summary.total,
        passedChecks: summary.pass,
        failedChecks: summary.fail,
        skippedChecks: summary.skipped,
      },
    });

    revalidatePath(`/admin/orgs/${input.organizationId}`);
    return { ok: true, result: toSummary(row) };
  } catch (err) {
    log.error("[runIsolationCheckAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Check failed.",
    };
  }
}

export async function listIsolationCheckResultsAction(input: {
  organizationId: string;
  limit?: number;
}): Promise<
  | { ok: true; results: IsolationCheckSummary[] }
  | { ok: false; error: string }
> {
  await requireSuperadmin();
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);

  const rows = await db
    .select()
    .from(isolationCheckResults)
    .where(eq(isolationCheckResults.organizationId, input.organizationId))
    .orderBy(desc(isolationCheckResults.triggeredAt))
    .limit(limit);
  return { ok: true, results: rows.map(toSummary) };
}
