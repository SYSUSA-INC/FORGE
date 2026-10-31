import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { opportunityNextActions, type OpportunityNextAction } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { loadPursuitState, listPursuitsToRefresh } from "@/lib/next-action-state";
import { NEXT_ACTION_MAX, NEXT_ACTION_SNOOZE_DAYS, rankActions, reconcileNextActions, type NextActionPriority, type NextActionStatus, type ProposedAction, type StoredNextAction } from "@/lib/next-actions";

/**
 * BL-NEXT-ACTION phase 5a — keep the stored next actions of a pursuit in
 * step with the rules (on page open and nightly), list the open ones,
 * and record a person's Done or Not now.
 */
export type NextActionView = {
  id: string;
  kind: string;
  title: string;
  reason: string;
  href: string;
  priority: NextActionPriority;
  dueBy: Date | null;
  status: NextActionStatus;
};

function toStored(r: OpportunityNextAction): StoredNextAction {
  return { id: r.id, kind: r.kind, status: r.status as NextActionStatus, stage: r.stage, snoozedUntil: r.snoozedUntil, title: r.title, reason: r.reason, href: r.href, priority: r.priority as NextActionPriority, dueBy: r.dueBy };
}

function toView(r: OpportunityNextAction): NextActionView {
  return { id: r.id, kind: r.kind, title: r.title, reason: r.reason, href: r.href, priority: r.priority as NextActionPriority, dueBy: r.dueBy, status: r.status as NextActionStatus };
}

/**
 * Run the rules for one pursuit and write the difference. Returns the
 * open actions, ranked and capped, and who owns the pursuit. Null when
 * the opportunity is not in the organization.
 */
export async function syncNextActions(organizationId: string, opportunityId: string, now = new Date()): Promise<{ actions: NextActionView[]; ownerUserId: string | null } | null> {
  const loaded = await loadPursuitState(organizationId, opportunityId);
  if (!loaded) return null;
  const rows = await db
    .select()
    .from(opportunityNextActions)
    .where(and(eq(opportunityNextActions.organizationId, organizationId), eq(opportunityNextActions.opportunityId, opportunityId)));
  const rec = reconcileNextActions(rows.map(toStored), loaded.state, now);

  for (const c of rec.close) {
    await db
      .update(opportunityNextActions)
      .set({ status: c.status, decidedAt: c.status === "done" ? now : null, updatedAt: now })
      .where(and(eq(opportunityNextActions.organizationId, organizationId), eq(opportunityNextActions.id, c.id)));
  }
  for (const u of rec.update) {
    await db
      .update(opportunityNextActions)
      .set({ ...u.patch, updatedAt: now })
      .where(and(eq(opportunityNextActions.organizationId, organizationId), eq(opportunityNextActions.id, u.id)));
  }
  if (rec.insert.length > 0) {
    const inserted = await db
      .insert(opportunityNextActions)
      .values(
        rec.insert.map((p: ProposedAction) => ({
          organizationId,
          opportunityId,
          proposalId: p.proposalId,
          kind: p.kind,
          rule: p.rule,
          title: p.title,
          reason: p.reason,
          href: p.href,
          priority: p.priority,
          dueBy: p.dueBy,
          stage: loaded.state.stage,
          evidence: p.evidence,
          status: "proposed",
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning({ id: opportunityNextActions.id, kind: opportunityNextActions.kind, rule: opportunityNextActions.rule, evidence: opportunityNextActions.evidence });
    for (const row of inserted) {
      await recordAudit({
        organizationId,
        actor: { userId: null, email: "forge-rules" },
        action: "opportunity.next_action.propose",
        resourceType: "opportunity",
        resourceId: opportunityId,
        metadata: { nextActionId: row.id, kind: row.kind, rule: row.rule, evidence: row.evidence },
      });
    }
  }

  const open = (
    await db
      .select()
      .from(opportunityNextActions)
      .where(and(eq(opportunityNextActions.organizationId, organizationId), eq(opportunityNextActions.opportunityId, opportunityId), inArray(opportunityNextActions.status, ["proposed", "prepared"])))
  ).map((r) => ({ ...toView(r), rule: r.rule }));
  return { actions: rankActions(open).slice(0, NEXT_ACTION_MAX), ownerUserId: loaded.ownerUserId };
}

/** A person's decision on an open action. Permission is the caller's to check. */
export async function decideNextAction(input: { organizationId: string; id: string; decision: "done" | "dismissed"; actor: { userId: string; email?: string | null } }): Promise<{ ok: true; opportunityId: string; proposalId: string | null } | { ok: false; error: string }> {
  const now = new Date();
  const [row] = await db
    .select({ id: opportunityNextActions.id, opportunityId: opportunityNextActions.opportunityId, proposalId: opportunityNextActions.proposalId, kind: opportunityNextActions.kind, status: opportunityNextActions.status })
    .from(opportunityNextActions)
    .where(and(eq(opportunityNextActions.organizationId, input.organizationId), eq(opportunityNextActions.id, input.id)))
    .limit(1);
  if (!row) return { ok: false, error: "Action not found." };
  if (row.status !== "proposed" && row.status !== "prepared") return { ok: false, error: "This action is already closed." };
  await db
    .update(opportunityNextActions)
    .set({
      status: input.decision,
      decidedByUserId: input.actor.userId,
      decidedAt: now,
      snoozedUntil: input.decision === "dismissed" ? new Date(now.getTime() + NEXT_ACTION_SNOOZE_DAYS * 86_400_000) : null,
      updatedAt: now,
    })
    .where(and(eq(opportunityNextActions.organizationId, input.organizationId), eq(opportunityNextActions.id, row.id)));
  await recordAudit({
    organizationId: input.organizationId,
    actor: input.actor,
    action: input.decision === "done" ? "opportunity.next_action.done" : "opportunity.next_action.dismiss",
    resourceType: "opportunity",
    resourceId: row.opportunityId,
    metadata: { nextActionId: row.id, kind: row.kind },
  });
  return { ok: true, opportunityId: row.opportunityId, proposalId: row.proposalId };
}

/** The nightly pass: the rules over every pursuit that is active or recently closed, bounded per run. */
export async function refreshNextActions(opts: { limit?: number } = {}): Promise<{ checked: number; proposed: number; errors: number }> {
  const pursuits = await listPursuitsToRefresh(opts.limit ?? 300);
  let proposed = 0;
  let errors = 0;
  for (const p of pursuits) {
    try {
      const res = await syncNextActions(p.organizationId, p.opportunityId);
      proposed += res?.actions.length ?? 0;
    } catch (err) {
      errors += 1;
      log.error("[next-actions]", "refresh failed", { organizationId: p.organizationId, opportunityId: p.opportunityId, error: err });
    }
  }
  return { checked: pursuits.length, proposed, errors };
}
