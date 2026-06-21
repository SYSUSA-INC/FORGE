"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  memberships,
  opportunities,
  proposalSections,
  proposalTemplates,
  proposals,
  users,
  type ProposalSectionKind,
  type ProposalSectionStatus,
  type ProposalStage,
  type TemplateSectionSeed,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import {
  enforceQuota,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { DEFAULT_SECTIONS, countWords } from "@/lib/proposal-types";
import {
  EMPTY_DOC,
  countWords as countTipTapWords,
  projectToPlain,
  validateDoc,
} from "@/lib/tiptap-doc";
import { getDefaultTemplate } from "@/lib/template-defaults";
import { log } from "@/lib/log";

async function ownsProposal(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return !!row;
}

async function ownsOpportunity(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, id),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function listOpportunitiesForProposal() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      stage: opportunities.stage,
    })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId))
    .orderBy(desc(opportunities.updatedAt));
}

export async function listProposalTeamCandidates() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));
}

export async function createProposalAction(input: {
  opportunityId: string;
  title?: string;
  templateId?: string | null;
  proposalManagerUserId?: string | null;
  captureManagerUserId?: string | null;
  pricingLeadUserId?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.opportunityId) {
    return { ok: false, error: "Pick an opportunity." };
  }
  if (!(await ownsOpportunity(input.opportunityId, organizationId))) {
    return { ok: false, error: "Opportunity not found." };
  }

  // BL-16 Phase B-3b — bump the monthly proposal counter. Throws
  // QuotaExceededError when over limit; surfaced via the existing
  // result shape.
  try {
    await enforceQuota(organizationId, "proposalsPerMonth");
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const [opp] = await db
    .select({ title: opportunities.title })
    .from(opportunities)
    .where(eq(opportunities.id, input.opportunityId))
    .limit(1);

  const title = (input.title?.trim() || opp?.title || "Untitled proposal").slice(
    0,
    256,
  );

  // Resolve the template the user picked, or fall back to the org's default,
  // or fall back to the built-in DEFAULT_SECTIONS list.
  let templateId: string | null = input.templateId ?? null;
  let seedSections: { kind: ProposalSectionKind; title: string; ordering: number; pageLimit?: number | null }[] =
    DEFAULT_SECTIONS.map((s) => ({ ...s, pageLimit: null }));

  try {
    if (templateId) {
      const [t] = await db
        .select({
          id: proposalTemplates.id,
          sectionSeed: proposalTemplates.sectionSeed,
        })
        .from(proposalTemplates)
        .where(
          and(
            eq(proposalTemplates.id, templateId),
            eq(proposalTemplates.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (t) {
        seedSections = (t.sectionSeed as TemplateSectionSeed[] | null) ?? seedSections;
      } else {
        templateId = null; // ignore stale id
      }
    } else {
      // Fall back to org default if one is set.
      const fallback = await getDefaultTemplate(organizationId);
      if (fallback) {
        templateId = fallback.id;
        seedSections =
          (fallback.sectionSeed as TemplateSectionSeed[] | null) ?? seedSections;
      }
    }
  } catch (err) {
    log.warn("[createProposalAction]", "template lookup failed", { error: err });
    templateId = null;
  }

  // BL-16 Phase B-3d — track whether the proposal row was actually
  // inserted; if a downstream step (sections insert / audit / dispatch)
  // fails, the proposal still exists in the DB so we keep the slot.
  // Only refund when the proposal itself was never created.
  let proposalCreated = false;
  try {
    const [row] = await db
      .insert(proposals)
      .values({
        organizationId,
        opportunityId: input.opportunityId,
        templateId,
        title,
        proposalManagerUserId: input.proposalManagerUserId ?? actor.id,
        captureManagerUserId: input.captureManagerUserId ?? null,
        pricingLeadUserId: input.pricingLeadUserId ?? null,
        createdByUserId: actor.id,
      })
      .returning({ id: proposals.id });
    if (!row) {
      await refundQuota(organizationId, "proposalsPerMonth");
      return { ok: false, error: "Could not create proposal." };
    }
    proposalCreated = true;

    await db.insert(proposalSections).values(
      seedSections.map((s) => ({
        proposalId: row.id,
        kind: s.kind,
        title: s.title,
        ordering: s.ordering,
        pageLimit: s.pageLimit ?? null,
      })),
    );

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.create",
      resourceType: "proposal",
      resourceId: row.id,
      metadata: {
        title: input.title,
        opportunityId: input.opportunityId,
        sectionCount: seedSections.length,
      },
    });

    // BL-13 — fire the rules engine.
    await dispatchTriggerEvent({
      organizationId,
      kind: "proposal_created",
      payload: {
        proposalId: row.id,
        opportunityId: input.opportunityId,
        title,
      },
      subject: `Proposal created: ${title}`,
      linkPath: `/proposals/${row.id}`,
      proposalId: row.id,
      actorUserId: actor.id,
    });

    revalidatePath("/proposals");
    revalidatePath("/");
    return { ok: true, id: row.id };
  } catch (err) {
    // BL-16 Phase B-3d — refund only if the proposal row itself never
    // landed. If a downstream insert/audit failed, the proposal exists
    // and the slot was legitimately consumed.
    if (!proposalCreated) {
      await refundQuota(organizationId, "proposalsPerMonth");
    }
    log.error("[createProposalAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function updateProposalAction(
  id: string,
  input: {
    title?: string;
    proposalManagerUserId?: string | null;
    captureManagerUserId?: string | null;
    pricingLeadUserId?: string | null;
    notes?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(id, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  try {
    await db
      .update(proposals)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.proposalManagerUserId !== undefined
          ? { proposalManagerUserId: input.proposalManagerUserId || null }
          : {}),
        ...(input.captureManagerUserId !== undefined
          ? { captureManagerUserId: input.captureManagerUserId || null }
          : {}),
        ...(input.pricingLeadUserId !== undefined
          ? { pricingLeadUserId: input.pricingLeadUserId || null }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)));
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.update",
      resourceType: "proposal",
      resourceId: id,
      metadata: {
        fields: Object.keys(input),
      },
    });
    revalidatePath(`/proposals/${id}`);
    return { ok: true };
  } catch (err) {
    log.error("[updateProposalAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function advanceProposalStageAction(
  id: string,
  nextStage: ProposalStage,
): Promise<{ ok: true; harvestStarted?: boolean } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(id, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  try {
    // Detect "transition into submitted" so we only kick off the
    // harvest when the proposal moves INTO submitted, not on every
    // touch while already there.
    const [before] = await db
      .select({ stage: proposals.stage })
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)))
      .limit(1);
    const wasNotSubmitted = before && before.stage !== "submitted";

    await db
      .update(proposals)
      .set({
        stage: nextStage,
        submittedAt:
          nextStage === "submitted" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)));
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.advance_stage",
      resourceType: "proposal",
      resourceId: id,
      metadata: { fromStage: before?.stage ?? "unknown", toStage: nextStage },
    });
    revalidatePath(`/proposals/${id}`);
    revalidatePath("/proposals");
    revalidatePath("/");

    // Phase 10f: harvest into the corpus on transition to submitted.
    // Best-effort, fire-and-forget — failures don't block the stage
    // change. Users can re-run via the "Harvest now" button.
    let harvestStarted = false;
    if (nextStage === "submitted" && wasNotSubmitted) {
      harvestStarted = true;
      const { harvestProposalToCorpusAction } = await import(
        "./[id]/harvest-actions"
      );
      void harvestProposalToCorpusAction(id).catch((err) => {
        log.warn("[advanceProposalStage]", "harvest failed", { error: err });
      });
    }

    return { ok: true, harvestStarted };
  } catch (err) {
    log.error("[advanceProposalStageAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Stage change failed.",
    };
  }
}

export async function deleteProposalAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(id, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  await db
    .delete(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)));
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.delete",
    resourceType: "proposal",
    resourceId: id,
  });
  revalidatePath("/proposals");
  revalidatePath("/");
  return { ok: true };
}

export async function saveSectionAction(input: {
  proposalId: string;
  sectionId: string;
  title?: string;
  content?: string;
  bodyDoc?: import("@/db/schema").TipTapDoc;
  status?: ProposalSectionStatus;
  pageLimit?: number | null;
  authorUserId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(input.proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  try {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) update.title = input.title.trim();
    if (input.bodyDoc !== undefined) {
      const validated = validateDoc(input.bodyDoc) ?? EMPTY_DOC;
      const projected = projectToPlain(validated);
      update.bodyDoc = validated;
      update.content = projected;
      update.wordCount = countTipTapWords(validated);
    } else if (input.content !== undefined) {
      update.content = input.content;
      update.wordCount = countWords(input.content);
    }
    if (input.status !== undefined) update.status = input.status;
    if (input.pageLimit !== undefined) update.pageLimit = input.pageLimit;
    if (input.authorUserId !== undefined)
      update.authorUserId = input.authorUserId || null;

    await db
      .update(proposalSections)
      .set(update)
      .where(
        and(
          eq(proposalSections.id, input.sectionId),
          eq(proposalSections.proposalId, input.proposalId),
        ),
      );
    revalidatePath(`/proposals/${input.proposalId}/sections`);
    revalidatePath(`/proposals/${input.proposalId}`);
    return { ok: true };
  } catch (err) {
    log.error("[saveSectionAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Save failed.",
    };
  }
}

export async function addCustomSectionAction(input: {
  proposalId: string;
  kind: ProposalSectionKind;
  title: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(input.proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (!input.title.trim()) return { ok: false, error: "Title required." };

  const [maxOrder] = await db
    .select({ max: proposalSections.ordering })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, input.proposalId))
    .orderBy(desc(proposalSections.ordering))
    .limit(1);

  const [row] = await db
    .insert(proposalSections)
    .values({
      proposalId: input.proposalId,
      kind: input.kind,
      title: input.title.trim(),
      ordering: (maxOrder?.max ?? 0) + 1,
    })
    .returning({ id: proposalSections.id });

  revalidatePath(`/proposals/${input.proposalId}/sections`);
  return { ok: true, id: row!.id };
}

export async function removeSectionAction(
  proposalId: string,
  sectionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  await db
    .delete(proposalSections)
    .where(
      and(
        eq(proposalSections.id, sectionId),
        eq(proposalSections.proposalId, proposalId),
      ),
    );
  revalidatePath(`/proposals/${proposalId}/sections`);
  return { ok: true };
}
