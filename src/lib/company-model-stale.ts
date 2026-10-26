import "server-only";

import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, opportunityCapabilityMatrices, organizationModels, organizations, proposalOutcomes } from "@/db/schema";
import { computeStaleReasons, QUESTIONNAIRE_STALE_MIN_ANSWERS } from "@/lib/company-model-staleness";
import { log } from "@/lib/log";

/**
 * BL-COMPANY-MODEL phase 1b — the nightly step: for every approved model,
 * count what changed since its approval and store the reasons on the
 * row. Approve clears them. Bounded per run; each query is org-scoped.
 */
export async function refreshCompanyModelStaleness(opts: { limit?: number } = {}): Promise<{ checked: number; stale: number; errors: number }> {
  const limit = opts.limit ?? 200;
  const rows = await db
    .select({
      id: organizationModels.id,
      organizationId: organizationModels.organizationId,
      approvedAt: organizationModels.approvedAt,
      approvedSources: organizationModels.approvedSources,
      staleReasons: organizationModels.staleReasons,
      naicsList: organizations.naicsList,
      primaryNaics: organizations.primaryNaics,
      pastPerformance: organizations.pastPerformance,
    })
    .from(organizationModels)
    .innerJoin(organizations, eq(organizations.id, organizationModels.organizationId))
    .where(and(isNotNull(organizationModels.approved), isNotNull(organizationModels.approvedAt)))
    .limit(limit);

  let stale = 0;
  let errors = 0;
  for (const row of rows) {
    const since = row.approvedAt!;
    try {
      const [[outcomes], [entries], matrices] = await Promise.all([
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(proposalOutcomes)
          .where(and(eq(proposalOutcomes.organizationId, row.organizationId), gt(proposalOutcomes.updatedAt, since))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(knowledgeEntries)
          .where(and(eq(knowledgeEntries.organizationId, row.organizationId), eq(knowledgeEntries.kind, "capability"), gt(knowledgeEntries.updatedAt, since))),
        db
          .select({ answers: opportunityCapabilityMatrices.answers })
          .from(opportunityCapabilityMatrices)
          .where(and(eq(opportunityCapabilityMatrices.organizationId, row.organizationId), gt(opportunityCapabilityMatrices.updatedAt, since))),
      ]);
      const reasons = computeStaleReasons(row.approvedSources, {
        outcomesSince: outcomes?.n ?? 0,
        questionnairesSince: matrices.filter((m) => Object.keys(m.answers).length >= QUESTIONNAIRE_STALE_MIN_ANSWERS).length,
        capabilityEntriesSince: entries?.n ?? 0,
        currentPastPerformanceIds: row.pastPerformance.map((p) => p.id),
        currentNaicsCodes: [row.primaryNaics, ...row.naicsList].map((c) => c.replace(/\D/g, "")).filter(Boolean),
      });
      if (reasons.length > 0) stale += 1;
      if (JSON.stringify(reasons) !== JSON.stringify(row.staleReasons)) {
        await db
          .update(organizationModels)
          .set({ staleReasons: reasons })
          .where(and(eq(organizationModels.id, row.id), eq(organizationModels.organizationId, row.organizationId)));
      }
    } catch (err) {
      errors += 1;
      log.error("[company-model-stale]", "staleness check failed", { organizationId: row.organizationId, error: err });
    }
  }
  return { checked: rows.length, stale, errors };
}
