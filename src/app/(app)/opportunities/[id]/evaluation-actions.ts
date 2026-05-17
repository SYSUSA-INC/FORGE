"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  opportunityCompetitors,
  opportunityEvaluations,
  type OpportunityActivityKind,
  type OpportunityStage,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { STAGE_LABELS } from "@/lib/opportunity-types";

async function ownsOpportunity(
  opportunityId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function addActivityAction(input: {
  opportunityId: string;
  kind: OpportunityActivityKind;
  title?: string;
  body: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!(await ownsOpportunity(input.opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }
  if (!input.body.trim() && !input.title?.trim()) {
    return { ok: false, error: "Add a title or body." };
  }

  const [row] = await db
    .insert(opportunityActivities)
    .values({
      opportunityId: input.opportunityId,
      userId: actor.id,
      kind: input.kind,
      title: input.title?.trim() ?? "",
      body: input.body.trim(),
    })
    .returning({ id: opportunityActivities.id });

  if (row) {
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "opportunity.activity.create",
      resourceType: "opportunity_activity",
      resourceId: row.id,
      metadata: {
        opportunityId: input.opportunityId,
        kind: input.kind,
      },
    });
  }

  revalidatePath(`/opportunities/${input.opportunityId}`);
  return { ok: true, id: row!.id };
}

export async function deleteActivityAction(
  opportunityId: string,
  activityId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsOpportunity(opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }
  await db
    .delete(opportunityActivities)
    .where(
      and(
        eq(opportunityActivities.id, activityId),
        eq(opportunityActivities.opportunityId, opportunityId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.activity.delete",
    resourceType: "opportunity_activity",
    resourceId: activityId,
    metadata: { opportunityId },
  });
  revalidatePath(`/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function setStageWithLogAction(
  opportunityId: string,
  newStage: OpportunityStage,
  reasoning: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsOpportunity(opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }

  const [current] = await db
    .select({ stage: opportunities.stage })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  const fromLabel = current ? STAGE_LABELS[current.stage] : "";
  const toLabel = STAGE_LABELS[newStage];

  await db
    .update(opportunities)
    .set({ stage: newStage, updatedAt: new Date() })
    .where(eq(opportunities.id, opportunityId));

  const isGate = newStage === "no_bid" || newStage === "lost";
  await db.insert(opportunityActivities).values({
    opportunityId,
    userId: actor.id,
    kind: isGate ? "gate_decision" : "stage_change",
    title: `${fromLabel} → ${toLabel}`,
    body: reasoning.trim(),
    metadata: { from: current?.stage ?? null, to: newStage },
  });

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: isGate ? "opportunity.gate_decision" : "opportunity.advance_stage",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: {
      fromStage: current?.stage ?? null,
      toStage: newStage,
      hasReasoning: reasoning.trim().length > 0,
    },
  });

  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/opportunities");
  revalidatePath("/");
  return { ok: true };
}

export async function saveEvaluationAction(input: {
  opportunityId: string;
  strategicFit: number;
  customerRelationship: number;
  competitivePosture: number;
  resourceAvailability: number;
  financialAttractiveness: number;
  rationale: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsOpportunity(input.opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  await db
    .insert(opportunityEvaluations)
    .values({
      opportunityId: input.opportunityId,
      strategicFit: clamp(input.strategicFit),
      customerRelationship: clamp(input.customerRelationship),
      competitivePosture: clamp(input.competitivePosture),
      resourceAvailability: clamp(input.resourceAvailability),
      financialAttractiveness: clamp(input.financialAttractiveness),
      rationale: input.rationale.trim(),
    })
    .onConflictDoUpdate({
      target: opportunityEvaluations.opportunityId,
      set: {
        strategicFit: clamp(input.strategicFit),
        customerRelationship: clamp(input.customerRelationship),
        competitivePosture: clamp(input.competitivePosture),
        resourceAvailability: clamp(input.resourceAvailability),
        financialAttractiveness: clamp(input.financialAttractiveness),
        rationale: input.rationale.trim(),
        updatedAt: new Date(),
      },
    });

  await db.insert(opportunityActivities).values({
    opportunityId: input.opportunityId,
    userId: actor.id,
    kind: "evaluation_update",
    title: "Evaluation updated",
    body: "",
  });

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.evaluation.save",
    resourceType: "opportunity_evaluation",
    resourceId: input.opportunityId,
    metadata: {
      opportunityId: input.opportunityId,
      strategicFit: clamp(input.strategicFit),
      customerRelationship: clamp(input.customerRelationship),
      competitivePosture: clamp(input.competitivePosture),
      resourceAvailability: clamp(input.resourceAvailability),
      financialAttractiveness: clamp(input.financialAttractiveness),
    },
  });

  revalidatePath(`/opportunities/${input.opportunityId}`);
  return { ok: true };
}

export async function addCompetitorAction(input: {
  opportunityId: string;
  name: string;
  isIncumbent: boolean;
  pastPerformance?: string;
  strengths?: string;
  weaknesses?: string;
  notes?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsOpportunity(input.opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const [row] = await db
    .insert(opportunityCompetitors)
    .values({
      opportunityId: input.opportunityId,
      name: input.name.trim(),
      isIncumbent: input.isIncumbent,
      pastPerformance: input.pastPerformance?.trim() ?? "",
      strengths: input.strengths?.trim() ?? "",
      weaknesses: input.weaknesses?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
    })
    .returning({ id: opportunityCompetitors.id });

  await db.insert(opportunityActivities).values({
    opportunityId: input.opportunityId,
    userId: actor.id,
    kind: "competitor_update",
    title: `Added competitor: ${input.name.trim()}`,
    body: "",
  });

  if (row) {
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "opportunity.competitor.create",
      resourceType: "opportunity_competitor",
      resourceId: row.id,
      metadata: {
        opportunityId: input.opportunityId,
        name: input.name.trim(),
        isIncumbent: input.isIncumbent,
      },
    });
  }

  revalidatePath(`/opportunities/${input.opportunityId}`);
  return { ok: true, id: row!.id };
}

export async function updateCompetitorAction(
  competitorId: string,
  opportunityId: string,
  input: {
    name: string;
    isIncumbent: boolean;
    pastPerformance?: string;
    strengths?: string;
    weaknesses?: string;
    notes?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsOpportunity(opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }
  await db
    .update(opportunityCompetitors)
    .set({
      name: input.name.trim(),
      isIncumbent: input.isIncumbent,
      pastPerformance: input.pastPerformance?.trim() ?? "",
      strengths: input.strengths?.trim() ?? "",
      weaknesses: input.weaknesses?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(opportunityCompetitors.id, competitorId),
        eq(opportunityCompetitors.opportunityId, opportunityId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.competitor.update",
    resourceType: "opportunity_competitor",
    resourceId: competitorId,
    metadata: {
      opportunityId,
      name: input.name.trim(),
      isIncumbent: input.isIncumbent,
    },
  });
  revalidatePath(`/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function removeCompetitorAction(
  competitorId: string,
  opportunityId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsOpportunity(opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }
  await db
    .delete(opportunityCompetitors)
    .where(
      and(
        eq(opportunityCompetitors.id, competitorId),
        eq(opportunityCompetitors.opportunityId, opportunityId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.competitor.delete",
    resourceType: "opportunity_competitor",
    resourceId: competitorId,
    metadata: { opportunityId },
  });
  revalidatePath(`/opportunities/${opportunityId}`);
  return { ok: true };
}

export async function listActivities(opportunityId: string) {
  return db
    .select()
    .from(opportunityActivities)
    .where(eq(opportunityActivities.opportunityId, opportunityId))
    .orderBy(desc(opportunityActivities.createdAt));
}
