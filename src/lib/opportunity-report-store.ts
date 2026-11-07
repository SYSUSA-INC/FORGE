import "server-only";

import { and, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import { companies, opportunities, opportunityCapabilityMatrices, opportunityReports, users, type OpportunityReportKind } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { buildMatrixReport } from "@/lib/opportunity-report";

/**
 * BL-NAV-LIFECYCLE phase 2b-2 — saving and reading an opportunity's
 * reports. Each save is the next version for that opportunity and kind
 * (a unique index keeps two saves from taking the same number; the loser
 * retries once). Every query carries organizationId; callers own auth.
 */
export type ReportSummary = { id: string; kind: OpportunityReportKind; version: number; createdAt: string; by: string | null };

export async function saveMatrixReport(input: { organizationId: string; opportunityId: string; actor: { userId: string; email?: string | null }; now?: Date }): Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }> {
  const { organizationId, opportunityId } = input;
  const [opp] = await db
    .select({ title: opportunities.title, agency: opportunities.agency, solicitationNumber: opportunities.solicitationNumber, naics: opportunities.naicsCode, due: opportunities.responseDueDate })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const [matrix] = await db
    .select({ questions: opportunityCapabilityMatrices.questions, answers: opportunityCapabilityMatrices.answers })
    .from(opportunityCapabilityMatrices)
    .where(and(eq(opportunityCapabilityMatrices.organizationId, organizationId), eq(opportunityCapabilityMatrices.opportunityId, opportunityId)))
    .limit(1);
  if (!matrix || matrix.questions.length === 0) return { ok: false, error: "Build the capability matrix first." };
  const answers = matrix.answers ?? {};
  if (!matrix.questions.some((q) => answers[q.id])) return { ok: false, error: "Answer at least one question first." };

  const partnerIds = [...new Set(Object.values(answers).map((a) => a.partnerCompanyId).filter((x): x is string => !!x))];
  const partners = partnerIds.length
    ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.organizationId, organizationId), inArray(companies.id, partnerIds)))
    : [];
  const body = buildMatrixReport({
    opportunity: { title: opp.title, agency: opp.agency, solicitationNumber: opp.solicitationNumber, naics: opp.naics, dueDate: opp.due ? opp.due.toISOString() : null },
    questions: matrix.questions,
    answers,
    partnerNames: Object.fromEntries(partners.map((p) => [p.id, p.name])),
    now: input.now ?? new Date(),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [last] = await db
      .select({ v: max(opportunityReports.version) })
      .from(opportunityReports)
      .where(and(eq(opportunityReports.organizationId, organizationId), eq(opportunityReports.opportunityId, opportunityId), eq(opportunityReports.kind, "matrix")));
    const version = (last?.v ?? 0) + 1;
    try {
      const [row] = await db
        .insert(opportunityReports)
        .values({ organizationId, opportunityId, kind: "matrix", version, body: body as unknown as Record<string, unknown>, createdByUserId: input.actor.userId })
        .returning({ id: opportunityReports.id });
      await recordAudit({
        organizationId,
        actor: input.actor,
        action: "opportunity.report.save",
        resourceType: "opportunity",
        resourceId: opportunityId,
        metadata: { reportId: row!.id, kind: "matrix", version, coverage: body.coverage, questions: body.total },
      });
      return { ok: true, id: row!.id, version };
    } catch (err) {
      // Another save took this number at the same moment: take the next.
      if (attempt === 0 && /opportunity_report_version_uq|duplicate key/i.test(err instanceof Error ? err.message + String((err as { cause?: unknown }).cause ?? "") : String(err))) continue;
      throw err;
    }
  }
  return { ok: false, error: "Could not save the report. Try again." };
}

/** Each kind's latest report for an opportunity, with how many versions exist. */
export async function latestReports(organizationId: string, opportunityId: string): Promise<(ReportSummary & { versions: number })[]> {
  const rows = await db
    .select({ id: opportunityReports.id, kind: opportunityReports.kind, version: opportunityReports.version, createdAt: opportunityReports.createdAt, by: users.name })
    .from(opportunityReports)
    .leftJoin(users, eq(users.id, opportunityReports.createdByUserId))
    .where(and(eq(opportunityReports.organizationId, organizationId), eq(opportunityReports.opportunityId, opportunityId)))
    .orderBy(desc(opportunityReports.version));
  const out = new Map<string, ReportSummary & { versions: number }>();
  for (const r of rows) {
    const seen = out.get(r.kind);
    if (seen) seen.versions += 1;
    else out.set(r.kind, { id: r.id, kind: r.kind, version: r.version, createdAt: r.createdAt.toISOString(), by: r.by, versions: 1 });
  }
  return [...out.values()];
}

/** One saved report, this organization's only, with the other versions of its kind (newest first). */
export async function getReport(organizationId: string, reportId: string): Promise<{ report: ReportSummary & { opportunityId: string; body: Record<string, unknown> }; versions: ReportSummary[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return null;
  const [r] = await db
    .select({ id: opportunityReports.id, opportunityId: opportunityReports.opportunityId, kind: opportunityReports.kind, version: opportunityReports.version, body: opportunityReports.body, createdAt: opportunityReports.createdAt, by: users.name })
    .from(opportunityReports)
    .leftJoin(users, eq(users.id, opportunityReports.createdByUserId))
    .where(and(eq(opportunityReports.organizationId, organizationId), eq(opportunityReports.id, reportId)))
    .limit(1);
  if (!r) return null;
  const versions = await db
    .select({ id: opportunityReports.id, kind: opportunityReports.kind, version: opportunityReports.version, createdAt: opportunityReports.createdAt, by: users.name })
    .from(opportunityReports)
    .leftJoin(users, eq(users.id, opportunityReports.createdByUserId))
    .where(and(eq(opportunityReports.organizationId, organizationId), eq(opportunityReports.opportunityId, r.opportunityId), eq(opportunityReports.kind, r.kind)))
    .orderBy(desc(opportunityReports.version))
    .limit(50);
  return {
    report: { id: r.id, opportunityId: r.opportunityId, kind: r.kind, version: r.version, body: r.body, createdAt: r.createdAt.toISOString(), by: r.by },
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
  };
}
