"use server";

import { and, eq } from "drizzle-orm";
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
import { applyOpportunityStage } from "@/lib/opportunity-stage";

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

  // BL-AIP-1 — one write path for stage changes: activity row, audit,
  // and the BL-13 rules event. Until now the gate decision skipped the
  // rules engine, so "notify me when we no-bid" rules never fired.
  await applyOpportunityStage({
    organizationId,
    opportunityId,
    stage: newStage,
    actor: { userId: actor.id, email: actor.email },
    reasoning,
    source: "gate_decision",
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

// `listActivities` used to be exported from this "use server" file with
// no auth gate and no tenant scope — a callable endpoint that returned
// any opportunity's timeline by id. Nothing called it; removed in
// BL-AIP-1. The activity page reads through its own scoped query.
