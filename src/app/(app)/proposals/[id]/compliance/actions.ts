"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  complianceItems,
  proposalSections,
  proposals,
  type ComplianceCategory,
  type ComplianceStatus,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

async function ownsProposal(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return !!row;
}

export type ComplianceItemInput = {
  category: ComplianceCategory;
  number: string;
  requirementText: string;
  volume: string;
  rfpPageReference: string;
  proposalSectionId: string | null;
  proposalPageReference: string;
  status: ComplianceStatus;
  notes: string;
  ownerUserId: string | null;
};

export async function createComplianceItemAction(
  proposalId: string,
  input: ComplianceItemInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (!input.requirementText.trim()) {
    return { ok: false, error: "Requirement text is required." };
  }

  try {
    const [maxOrder] = await db
      .select({ max: complianceItems.ordering })
      .from(complianceItems)
      .where(eq(complianceItems.proposalId, proposalId))
      .orderBy(desc(complianceItems.ordering))
      .limit(1);

    const [row] = await db
      .insert(complianceItems)
      .values({
        proposalId,
        category: input.category,
        number: input.number.trim(),
        requirementText: input.requirementText.trim(),
        volume: input.volume.trim(),
        rfpPageReference: input.rfpPageReference.trim(),
        proposalSectionId: input.proposalSectionId,
        proposalPageReference: input.proposalPageReference.trim(),
        status: input.status,
        notes: input.notes.trim(),
        ordering: (maxOrder?.max ?? 0) + 1,
        ownerUserId: input.ownerUserId,
        createdByUserId: actor.id,
      })
      .returning({ id: complianceItems.id });
    if (!row) return { ok: false, error: "Could not create item." };

    revalidatePath(`/proposals/${proposalId}/compliance`);
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[createComplianceItemAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function updateComplianceItemAction(
  proposalId: string,
  itemId: string,
  input: Partial<ComplianceItemInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  try {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.category !== undefined) update.category = input.category;
    if (input.number !== undefined) update.number = input.number.trim();
    if (input.requirementText !== undefined)
      update.requirementText = input.requirementText.trim();
    if (input.volume !== undefined) update.volume = input.volume.trim();
    if (input.rfpPageReference !== undefined)
      update.rfpPageReference = input.rfpPageReference.trim();
    if (input.proposalSectionId !== undefined)
      update.proposalSectionId = input.proposalSectionId;
    if (input.proposalPageReference !== undefined)
      update.proposalPageReference = input.proposalPageReference.trim();
    if (input.status !== undefined) update.status = input.status;
    if (input.notes !== undefined) update.notes = input.notes.trim();
    if (input.ownerUserId !== undefined)
      update.ownerUserId = input.ownerUserId;

    await db
      .update(complianceItems)
      .set(update)
      .where(
        and(
          eq(complianceItems.id, itemId),
          eq(complianceItems.proposalId, proposalId),
        ),
      );

    revalidatePath(`/proposals/${proposalId}/compliance`);
    return { ok: true };
  } catch (err) {
    console.error("[updateComplianceItemAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function deleteComplianceItemAction(
  proposalId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  await db
    .delete(complianceItems)
    .where(
      and(
        eq(complianceItems.id, itemId),
        eq(complianceItems.proposalId, proposalId),
      ),
    );
  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true };
}

export async function bulkImportComplianceItemsAction(
  proposalId: string,
  input: {
    category: ComplianceCategory;
    lines: string[];
  },
): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  const cleaned = input.lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (cleaned.length === 0) {
    return { ok: false, error: "No lines to import." };
  }

  const [maxOrder] = await db
    .select({ max: complianceItems.ordering })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId))
    .orderBy(desc(complianceItems.ordering))
    .limit(1);
  let order = (maxOrder?.max ?? 0) + 1;

  // naive parse: "L.3.2 The contractor shall..." or "M-1: ..."
  const split = cleaned.map((line) => {
    const m = line.match(/^([A-Z][\w.\-]*)\s+(.*)$/);
    if (m && m[1] && m[2]) return { number: m[1], requirementText: m[2] };
    const m2 = line.match(/^([A-Z][\w.\-]*)[:.\-]\s*(.*)$/);
    if (m2 && m2[1] && m2[2]) return { number: m2[1], requirementText: m2[2] };
    return { number: "", requirementText: line };
  });

  await db.insert(complianceItems).values(
    split.map((s) => ({
      proposalId,
      category: input.category,
      number: s.number,
      requirementText: s.requirementText,
      ordering: order++,
      createdByUserId: actor.id,
    })),
  );

  revalidatePath(`/proposals/${proposalId}/compliance`);
  return { ok: true, imported: cleaned.length };
}

export async function listProposalSectionsLite(proposalId: string) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return [];
  }
  return db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));
}
