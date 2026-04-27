"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
import { DEFAULT_SECTIONS, countWords } from "@/lib/proposal-types";
import {
  EMPTY_DOC,
  countWords as countTipTapWords,
  projectToPlain,
  validateDoc,
} from "@/lib/tiptap-doc";
import { getDefaultTemplate } from "@/app/(app)/settings/templates/actions";

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
    console.warn("[createProposalAction] template lookup failed", err);
    templateId = null;
  }

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
    if (!row) return { ok: false, error: "Could not create proposal." };

    await db.insert(proposalSections).values(
      seedSections.map((s) => ({
        proposalId: row.id,
        kind: s.kind,
        title: s.title,
        ordering: s.ordering,
        pageLimit: s.pageLimit ?? null,
      })),
    );

    revalidatePath("/proposals");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[createProposalAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function createProposalAndGoAction(input: {
  opportunityId: string;
  title?: string;
  templateId?: string | null;
  proposalManagerUserId?: string | null;
  captureManagerUserId?: string | null;
  pricingLeadUserId?: string | null;
}): Promise<void> {
  const res = await createProposalAction(input);
  if (res.ok) redirect(`/proposals/${res.id}`);
  throw new Error(res.ok ? "unreachable" : res.error);
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
  await requireAuth();
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
      .where(eq(proposals.id, id));
    revalidatePath(`/proposals/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateProposalAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function advanceProposalStageAction(
  id: string,
  nextStage: ProposalStage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(id, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  try {
    await db
      .update(proposals)
      .set({
        stage: nextStage,
        submittedAt:
          nextStage === "submitted" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id));
    revalidatePath(`/proposals/${id}`);
    revalidatePath("/proposals");
    return { ok: true };
  } catch (err) {
    console.error("[advanceProposalStageAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Stage change failed.",
    };
  }
}

export async function deleteProposalAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(id, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  await db.delete(proposals).where(eq(proposals.id, id));
  revalidatePath("/proposals");
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
    console.error("[saveSectionAction]", err);
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
