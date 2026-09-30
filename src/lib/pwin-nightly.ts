/**
 * BL-AIP-7b part ii — nightly PWin snapshots and "PWin movers".
 *
 * The calibrated PWin (`computePwin`) was only frozen when a person
 * applied it or when a proposal was decided, so nobody could see an
 * estimate drift while a pursuit was live. Now:
 *
 *   nightly — for every live opportunity of a tenant, the cron computes
 *             the estimate and stores a `pwin_snapshot` row with trigger
 *             "nightly" when it differs from the last nightly row (PWin,
 *             confidence or factors), or when the last one is a week
 *             old, so every live pursuit has a weekly baseline.
 *   movers  — `listPwinMovers` reads the last week of snapshots for the
 *             tenant's live opportunities and returns the biggest moves
 *             with the factor changes behind them (`computeMovers`,
 *             pure), for the Command Center and /intelligence.
 *
 * The Brier track (`getPwinTrack`) still reads outcome snapshots only.
 * Every read and write carries organizationId; `runPwinSnapshotCron` is
 * the cross-org worker (same exemption as the other cron libs).
 */
import "server-only";

import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, pwinSnapshots } from "@/db/schema";
import { log } from "@/lib/log";
import { computePwin, snapshotPwin } from "@/lib/pwin";
import { computeMovers, snapshotChanged, type MoverSnapshot, type PwinMover } from "@/lib/pwin-movers";

const DAY_MS = 24 * 60 * 60_000;
const CLOSED_STAGES = ["won", "lost", "no_bid"] as const;
/** Live opportunities snapshotted per tenant per night. */
const MAX_OPPORTUNITIES_PER_ORG = 100;
/** A weekly baseline row even when nothing moved. */
const BASELINE_AFTER_DAYS = 6;
const MOVERS_WINDOW_DAYS = 7;

export type PwinSnapshotSummary = {
  opportunities: number;
  snapshotted: number;
  unchanged: number;
  errors: number;
};

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

/**
 * Freeze tonight's estimate for each live opportunity of one tenant,
 * skipping those whose estimate has not moved since the last nightly
 * row (unless that row is a week old).
 */
export async function snapshotOrganizationPwin(input: {
  organizationId: string;
  now?: Date;
  maxOpportunities?: number;
}): Promise<PwinSnapshotSummary> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const summary: PwinSnapshotSummary = { opportunities: 0, snapshotted: 0, unchanged: 0, errors: 0 };

  const live = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(eq(opportunities.organizationId, organizationId), notInArray(opportunities.stage, [...CLOSED_STAGES])),
    )
    .orderBy(desc(opportunities.updatedAt))
    .limit(input.maxOpportunities ?? MAX_OPPORTUNITIES_PER_ORG);
  summary.opportunities = live.length;
  if (live.length === 0) return summary;

  // The last nightly row per opportunity, in one query.
  const ids = live.map((o) => o.id);
  const previous = await db
    .select({
      opportunityId: pwinSnapshots.opportunityId,
      pwin: pwinSnapshots.pwin,
      confidence: pwinSnapshots.confidence,
      factors: pwinSnapshots.factors,
      createdAt: pwinSnapshots.createdAt,
    })
    .from(pwinSnapshots)
    .where(
      and(
        eq(pwinSnapshots.organizationId, organizationId),
        eq(pwinSnapshots.trigger, "nightly"),
        inArray(pwinSnapshots.opportunityId, ids),
      ),
    )
    .orderBy(desc(pwinSnapshots.createdAt));
  const lastByOpp = new Map<string, (typeof previous)[number]>();
  for (const p of previous) {
    if (!lastByOpp.has(p.opportunityId)) lastByOpp.set(p.opportunityId, p);
  }

  for (const o of live) {
    try {
      const estimate = await computePwin(organizationId, o.id);
      if (!estimate) continue;
      const last = lastByOpp.get(o.id) ?? null;
      const stale = last ? now.getTime() - last.createdAt.getTime() >= BASELINE_AFTER_DAYS * DAY_MS : true;
      const changed = snapshotChanged(
        last ? { pwin: last.pwin, confidence: last.confidence, factors: last.factors } : null,
        { pwin: estimate.score.pwin, confidence: estimate.score.confidence, factors: estimate.score.factors },
      );
      if (!changed && !stale) {
        summary.unchanged += 1;
        continue;
      }
      await snapshotPwin({ organizationId, estimate, trigger: "nightly" });
      summary.snapshotted += 1;
    } catch (err) {
      summary.errors += 1;
      log.warn("[pwin-nightly]", "snapshot failed", { organizationId, opportunityId: o.id, error: err });
    }
  }
  return summary;
}

export type PwinSnapshotCronSummary = {
  organizations: number;
  opportunities: number;
  snapshotted: number;
  unchanged: number;
  errors: number;
  /** Tenants left for the next tick (time budget). */
  deferred: number;
};

/**
 * Every enabled tenant with a live opportunity, oldest-touched first,
 * inside a time budget. Cross-org by design: a background worker; each
 * tenant's work goes through `snapshotOrganizationPwin` with its own id.
 */
export async function runPwinSnapshotCron(
  opts: { maxOrgs?: number; budgetMs?: number } = {},
): Promise<PwinSnapshotCronSummary> {
  const maxOrgs = opts.maxOrgs ?? 40;
  const budgetMs = opts.budgetMs ?? 240_000;
  const started = Date.now();
  const summary: PwinSnapshotCronSummary = {
    organizations: 0,
    opportunities: 0,
    snapshotted: 0,
    unchanged: 0,
    errors: 0,
    deferred: 0,
  };

  const due = rowsOf<{ organization_id: string }>(
    await db.execute(sql`
      SELECT o.organization_id
      FROM opportunity o
      JOIN organization org ON org.id = o.organization_id
      WHERE org.disabled_at IS NULL
        AND o.stage NOT IN ('won', 'lost', 'no_bid')
      GROUP BY o.organization_id
      ORDER BY MAX(o.updated_at) DESC
      LIMIT ${maxOrgs}
    `),
  );

  for (const row of due) {
    if (Date.now() - started > budgetMs) {
      summary.deferred += 1;
      continue;
    }
    const organizationId = row.organization_id;
    try {
      const r = await snapshotOrganizationPwin({ organizationId });
      summary.organizations += 1;
      summary.opportunities += r.opportunities;
      summary.snapshotted += r.snapshotted;
      summary.unchanged += r.unchanged;
      summary.errors += r.errors;
    } catch (err) {
      summary.errors += 1;
      log.error("[pwin-nightly]", "tenant run failed", { organizationId, error: err });
    }
  }
  return summary;
}

export type PwinMoverView = PwinMover & {
  title: string;
  agency: string;
  stage: string;
};

/**
 * The tenant's biggest PWin moves over the last week among live
 * opportunities, with the factor changes behind each.
 */
export async function listPwinMovers(input: {
  organizationId: string;
  limit?: number;
  now?: Date;
}): Promise<PwinMoverView[]> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (MOVERS_WINDOW_DAYS + 1) * DAY_MS);

  const rows = await db
    .select({
      opportunityId: pwinSnapshots.opportunityId,
      pwin: pwinSnapshots.pwin,
      confidence: pwinSnapshots.confidence,
      factors: pwinSnapshots.factors,
      createdAt: pwinSnapshots.createdAt,
      title: opportunities.title,
      agency: opportunities.agency,
      stage: opportunities.stage,
    })
    .from(pwinSnapshots)
    .innerJoin(opportunities, eq(opportunities.id, pwinSnapshots.opportunityId))
    .where(
      and(
        eq(pwinSnapshots.organizationId, organizationId),
        eq(opportunities.organizationId, organizationId),
        inArray(pwinSnapshots.trigger, ["nightly", "apply"]),
        gte(pwinSnapshots.createdAt, since),
        notInArray(opportunities.stage, [...CLOSED_STAGES]),
      ),
    )
    .orderBy(desc(pwinSnapshots.createdAt))
    .limit(2_000);

  const snapshots: MoverSnapshot[] = rows.map((r) => ({
    opportunityId: r.opportunityId,
    pwin: r.pwin,
    confidence: r.confidence,
    factors: r.factors,
    createdAt: r.createdAt,
  }));
  const meta = new Map(rows.map((r) => [r.opportunityId, { title: r.title, agency: r.agency, stage: r.stage }]));
  return computeMovers(snapshots, { now, windowDays: MOVERS_WINDOW_DAYS, limit: input.limit ?? 6 }).map((m) => ({
    ...m,
    title: meta.get(m.opportunityId)?.title ?? "",
    agency: meta.get(m.opportunityId)?.agency ?? "",
    stage: meta.get(m.opportunityId)?.stage ?? "",
  }));
}
