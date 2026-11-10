"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { auditDraftCreate, draftProposalOf, planInputs, seedWinThemes } from "@/lib/develop-store";
import { opportunityHasSectionL } from "@/lib/proposal-bootstrap";
import { createProposalAction } from "@/app/(app)/proposals/actions";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Result = { ok: true; proposalId: string; existed: boolean; note?: string } | { ok: false; error: string };

/**
 * BL-NAV-LIFECYCLE 5a (D-1) — Create a Draft from the plan, one click:
 * the leads from the team, the outline from Section L (the frozen
 * outline's source), the win themes from the signed charter. Idempotent:
 * a proposal already on the opportunity is returned, not duplicated.
 * The opportunity stays where it is.
 */
export async function createDraftAction(input: { opportunityId: string }): Promise<Result> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const opportunityId = String(input?.opportunityId ?? "");
  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };

  const existing = await draftProposalOf(organizationId, opportunityId);
  if (existing) return { ok: true, proposalId: existing.id, existed: true };

  const plan = await planInputs(organizationId, opportunityId);
  const hasSectionL = await opportunityHasSectionL({ organizationId, opportunityId });
  const created = await createProposalAction({
    opportunityId,
    proposalManagerUserId: plan.leads.proposalManagerUserId,
    captureManagerUserId: plan.leads.captureManagerUserId,
    pricingLeadUserId: plan.leads.pricingLeadUserId,
    bootstrapFromSolicitation: hasSectionL,
  });
  if (!created.ok) return created;

  const wroteThemes = await seedWinThemes(organizationId, created.id, plan.winThemes);
  await auditDraftCreate({
    organizationId,
    actor: { userId: actor.id, email: actor.email, name: actor.name },
    opportunityId,
    proposalId: created.id,
    metadata: { ...plan.leads, wroteThemes, outlineFromSectionL: created.bootstrap?.applied ?? false, planFrozen: plan.frozen, charterSigned: plan.signed },
  });
  revalidatePath("/");
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/develop`);
  revalidatePath("/pipeline/develop");
  revalidatePath("/proposals");
  return { ok: true, proposalId: created.id, existed: false, ...(created.bootstrap && !created.bootstrap.applied && created.bootstrap.error ? { note: created.bootstrap.error } : {}) };
}
