/**
 * BL-AIP-1 — the single write path for an opportunity stage change.
 *
 * Every stage change, whether a capture manager clicks a gate decision
 * or a proposal outcome is recorded, goes through here so the three
 * side effects always happen together:
 *   1. the activity-timeline row (gate decisions keep their reasoning),
 *   2. the audit row,
 *   3. the BL-13 rules event (opportunity_won / _lost / _no_bid /
 *      _advanced) so notification rules actually fire.
 *
 * Before this existed the gate decision skipped the rules engine and the
 * outcome save never touched the opportunity at all.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  type OpportunityStage,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { isClosedStage, ruleKindForStage } from "@/lib/opportunity-stage-map";
import { STAGE_LABELS } from "@/lib/opportunity-types";

export type ApplyOpportunityStageInput = {
  organizationId: string;
  opportunityId: string;
  stage: OpportunityStage;
  actor: { userId: string; email?: string | null };
  /** Free text for the activity row; gate decisions carry the reasoning. */
  reasoning?: string;
  /** Recorded on the activity and audit rows. */
  source: "gate_decision" | "proposal_outcome";
};

export type ApplyOpportunityStageResult = {
  /** False when the opportunity is missing or already at that stage. */
  changed: boolean;
  from: OpportunityStage | null;
  to: OpportunityStage;
};

export async function applyOpportunityStage(
  input: ApplyOpportunityStageInput,
): Promise<ApplyOpportunityStageResult> {
  const { organizationId, opportunityId, stage } = input;
  const reasoning = (input.reasoning ?? "").trim();

  const [current] = await db
    .select({ stage: opportunities.stage })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!current) return { changed: false, from: null, to: stage };

  const isGate = isClosedStage(stage);
  const kind = isGate ? "gate_decision" : "stage_change";

  if (current.stage === stage) {
    // Nothing moves, but a re-stated decision with reasoning is still
    // worth keeping on the timeline.
    if (reasoning) {
      await db.insert(opportunityActivities).values({
        opportunityId,
        userId: input.actor.userId,
        kind,
        title: `${STAGE_LABELS[stage]} (reaffirmed)`,
        body: reasoning,
        metadata: { from: current.stage, to: stage, source: input.source },
      });
    }
    return { changed: false, from: current.stage, to: stage };
  }

  await db
    .update(opportunities)
    .set({ stage, updatedAt: new Date() })
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, opportunityId),
      ),
    );

  await db.insert(opportunityActivities).values({
    opportunityId,
    userId: input.actor.userId,
    kind,
    title: `${STAGE_LABELS[current.stage]} → ${STAGE_LABELS[stage]}`,
    body: reasoning,
    metadata: { from: current.stage, to: stage, source: input.source },
  });

  await recordAudit({
    organizationId,
    actor: { userId: input.actor.userId, email: input.actor.email },
    action: isGate ? "opportunity.gate_decision" : "opportunity.advance_stage",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: {
      fromStage: current.stage,
      toStage: stage,
      source: input.source,
      hasReasoning: reasoning.length > 0,
    },
  });

  // BL-13 — the rules engine. Best-effort: a dispatcher failure never
  // undoes a stage change that has already been recorded.
  try {
    await dispatchTriggerEvent({
      organizationId,
      kind: ruleKindForStage(stage),
      payload: {
        opportunityId,
        stage,
        fromStage: current.stage,
        source: input.source,
      },
      subject: `Opportunity ${isGate ? "closed as" : "advanced to"} ${STAGE_LABELS[stage]}`,
      linkPath: `/opportunities/${opportunityId}`,
      actorUserId: input.actor.userId,
    });
  } catch (err) {
    log.warn("[opportunity-stage]", "rules dispatch failed", { error: err });
  }

  return { changed: true, from: current.stage, to: stage };
}
