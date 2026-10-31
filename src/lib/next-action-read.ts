import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityNextActions } from "@/db/schema";
import { canonicalStage } from "@/lib/opportunity-types";
import { rankOrgActions, type NextActionPriority } from "@/lib/next-actions";
import type { OpportunityStage } from "@/db/schema";

/**
 * BL-NEXT-ACTION phase 5b — the organisation-wide reads: the Command
 * Center's list, the pipeline brief's input, the digest's lines and the
 * Reports figure. Open rows only (proposed or prepared); the nightly pass
 * and page opens keep them current.
 */
export type OrgNextAction = {
  id: string;
  kind: string;
  rule: string;
  title: string;
  reason: string;
  href: string;
  priority: NextActionPriority;
  dueBy: Date | null;
  opportunityId: string;
  opportunityTitle: string;
  stage: OpportunityStage;
  ownerUserId: string | null;
};

async function openRows(organizationId: string): Promise<OrgNextAction[]> {
  const rows = await db
    .select({
      id: opportunityNextActions.id,
      kind: opportunityNextActions.kind,
      rule: opportunityNextActions.rule,
      title: opportunityNextActions.title,
      reason: opportunityNextActions.reason,
      href: opportunityNextActions.href,
      priority: opportunityNextActions.priority,
      dueBy: opportunityNextActions.dueBy,
      opportunityId: opportunityNextActions.opportunityId,
      opportunityTitle: opportunities.title,
      stage: opportunities.stage,
      ownerUserId: opportunities.ownerUserId,
    })
    .from(opportunityNextActions)
    .innerJoin(opportunities, eq(opportunities.id, opportunityNextActions.opportunityId))
    .where(and(eq(opportunityNextActions.organizationId, organizationId), eq(opportunities.organizationId, organizationId), inArray(opportunityNextActions.status, ["proposed", "prepared"])))
    .limit(500);
  return rows.map((r) => ({ ...r, priority: r.priority as NextActionPriority, stage: canonicalStage(r.stage) }));
}

/** The Command Center: the reader's pursuits first, at most `max`. */
export async function listOpenNextActionsForOrg(organizationId: string, opts: { userId: string; max?: number }): Promise<OrgNextAction[]> {
  return rankOrgActions(await openRows(organizationId), opts.userId).slice(0, opts.max ?? 8);
}

/** The pipeline brief: the top open actions as the brief's input. */
export async function nextActionsForBrief(organizationId: string, max = 12): Promise<{ pursuit: string; stage: string; title: string; priority: NextActionPriority; dueDate: string | null }[]> {
  const rows = rankOrgActions(await openRows(organizationId), "").slice(0, max);
  return rows.map((r) => ({ pursuit: r.opportunityTitle, stage: r.stage, title: r.title, priority: r.priority, dueDate: r.dueBy ? r.dueBy.toISOString().slice(0, 10) : null }));
}

/** The digest: the reader's own pursuits' actions of priority now and this week. */
export async function nextActionsForDigest(organizationId: string, userId: string, max = 5): Promise<{ title: string; pursuit: string; href: string; priority: NextActionPriority }[]> {
  const rows = rankOrgActions(await openRows(organizationId), userId).filter((r) => r.ownerUserId === userId && r.priority !== "later");
  return rows.slice(0, max).map((r) => ({ title: r.title, pursuit: r.opportunityTitle, href: r.href, priority: r.priority }));
}

/** Reports: decided actions since `since` (all time when null), and what is open now. */
export async function nextActionStats(organizationId: string, since: Date | null): Promise<{ done: number; dismissed: number; open: number }> {
  const decidedWhere = since
    ? and(eq(opportunityNextActions.organizationId, organizationId), inArray(opportunityNextActions.status, ["done", "dismissed"]), gte(opportunityNextActions.decidedAt, since))
    : and(eq(opportunityNextActions.organizationId, organizationId), inArray(opportunityNextActions.status, ["done", "dismissed"]));
  const [decided, [open]] = await Promise.all([
    db.select({ status: opportunityNextActions.status, n: sql<number>`count(*)::int` }).from(opportunityNextActions).where(decidedWhere).groupBy(opportunityNextActions.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(opportunityNextActions)
      .where(and(eq(opportunityNextActions.organizationId, organizationId), inArray(opportunityNextActions.status, ["proposed", "prepared"]))),
  ]);
  const by = Object.fromEntries(decided.map((d) => [d.status, d.n]));
  return { done: by.done ?? 0, dismissed: by.dismissed ?? 0, open: open?.n ?? 0 };
}
