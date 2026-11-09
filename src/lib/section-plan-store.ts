import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationRules, opportunities, proposalSections, proposals, users, type ProposalSectionKind, type ProposalSectionStatus } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { isoDay } from "@/lib/milestone-logic";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { listPlanMembers } from "@/lib/plan-store";
import { isSectionOverdue, partsCount, sectionAssignedMessage, sectionHasDraft, type PartsCount } from "@/lib/section-plan-logic";

/**
 * BL-NAV-LIFECYCLE 4b-2 (P-4) — the parts' store: the sections of the
 * opportunity's proposals as the Plan tab lists them, with the owner
 * (the section author, as Develop sees it) and the due date set per
 * section, each audited. proposal_section carries no organization_id:
 * every query joins the proposal and filters on its organization.
 * Callers own the auth gate.
 */

type Actor = { userId: string; email?: string | null; name?: string | null };
type Result = { ok: true; id?: string } | { ok: false; error: string };

export type PartView = {
  id: string;
  proposalId: string;
  proposalTitle: string;
  title: string;
  kind: ProposalSectionKind;
  status: ProposalSectionStatus;
  authorUserId: string | null;
  authorName: string;
  dueDate: string | null;
  hasDraft: boolean;
  /** Past its date with no draft. */
  overdue: boolean;
};

export type PartsView = {
  todayIso: string;
  /** Proposals of the opportunity, so the list says which one a part belongs to when there are several. */
  proposals: { id: string; title: string }[];
  parts: PartView[];
  count: PartsCount;
};

async function ownOpportunity(organizationId: string, opportunityId: string): Promise<boolean> {
  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  return !!opp;
}

/** The parts as the Plan tab shows them; null when the opportunity is not the tenant's. */
export async function loadParts(input: { organizationId: string; opportunityId: string }): Promise<PartsView | null> {
  const { organizationId, opportunityId } = input;
  if (!(await ownOpportunity(organizationId, opportunityId))) return null;
  const todayIso = isoDay(new Date());
  const props = await db
    .select({ id: proposals.id, title: proposals.title })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)))
    .orderBy(asc(proposals.createdAt));
  if (props.length === 0) return { todayIso, proposals: [], parts: [], count: partsCount([]) };
  const rows = await db
    .select({
      id: proposalSections.id,
      proposalId: proposalSections.proposalId,
      title: proposalSections.title,
      kind: proposalSections.kind,
      status: proposalSections.status,
      content: proposalSections.content,
      wordCount: proposalSections.wordCount,
      authorUserId: proposalSections.authorUserId,
      authorName: users.name,
      authorEmail: users.email,
      dueDate: proposalSections.dueDate,
      ordering: proposalSections.ordering,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .leftJoin(users, eq(users.id, proposalSections.authorUserId))
    .where(and(eq(proposals.organizationId, organizationId), inArray(proposalSections.proposalId, props.map((p) => p.id))))
    .orderBy(asc(proposalSections.proposalId), asc(proposalSections.ordering), asc(proposalSections.createdAt));
  const titles = new Map(props.map((p) => [p.id, p.title]));
  const parts: PartView[] = rows.map((r) => ({
    id: r.id,
    proposalId: r.proposalId,
    proposalTitle: titles.get(r.proposalId) ?? "",
    title: r.title,
    kind: r.kind,
    status: r.status,
    authorUserId: r.authorUserId,
    authorName: r.authorName ?? r.authorEmail ?? "",
    dueDate: r.dueDate,
    hasDraft: sectionHasDraft(r),
    overdue: isSectionOverdue({ todayIso, dueDate: r.dueDate, draft: r }),
  }));
  return { todayIso, proposals: props, parts, count: partsCount(parts) };
}

/** One section of one of the opportunity's proposals, or null. */
async function partRow(organizationId: string, opportunityId: string, sectionId: string) {
  const [row] = await db
    .select({ id: proposalSections.id, proposalId: proposalSections.proposalId, title: proposalSections.title, authorUserId: proposalSections.authorUserId, dueDate: proposalSections.dueDate, proposalTitle: proposals.title })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.id, sectionId), eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)))
    .limit(1);
  return row ?? null;
}

/**
 * Names the part's owner (the section author). The owner is told through
 * proposal_section_assigned, with the due date, only when the author
 * changed to someone other than the actor, as the section editor does.
 */
export async function setPartOwner(input: { organizationId: string; opportunityId: string; sectionId: string; authorUserId: string | null; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const row = await partRow(organizationId, opportunityId, input.sectionId);
  if (!row) return { ok: false, error: "That section is not on one of this opportunity's proposals." };
  if (input.authorUserId) {
    const members = await listPlanMembers(organizationId);
    if (!members.some((m) => m.id === input.authorUserId)) return { ok: false, error: "That person is not an active member of this company." };
  }
  if ((row.authorUserId ?? null) === (input.authorUserId ?? null)) return { ok: true, id: row.id };
  await db.update(proposalSections).set({ authorUserId: input.authorUserId, updatedAt: new Date() }).where(and(eq(proposalSections.id, row.id), eq(proposalSections.proposalId, row.proposalId)));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "proposal.section.owner.set",
    resourceType: "proposal_section",
    resourceId: row.id,
    metadata: { opportunityId, proposalId: row.proposalId, title: row.title, before: row.authorUserId, after: input.authorUserId, dueDate: row.dueDate, from: "plan" },
  });
  if (input.authorUserId && input.authorUserId !== input.actor.userId) {
    const msg = sectionAssignedMessage({ sectionTitle: row.title, byName: input.actor.name ?? input.actor.email ?? "", dueDate: row.dueDate });
    await dispatchTriggerEvent({
      organizationId,
      kind: "proposal_section_assigned",
      payload: { proposalId: row.proposalId, sectionId: row.id, sectionTitle: row.title, dueDate: row.dueDate, opportunityId, mentionedUserIds: [input.authorUserId], assignedByUserId: input.actor.userId },
      subject: msg.subject,
      body: msg.body,
      linkPath: `/proposals/${row.proposalId}/sections`,
      proposalId: row.proposalId,
      actorUserId: input.actor.userId,
    });
  }
  return { ok: true, id: row.id };
}

/** Sets or clears the part's due date. */
export async function setPartDueDate(input: { organizationId: string; opportunityId: string; sectionId: string; dueDate: string | null; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const row = await partRow(organizationId, opportunityId, input.sectionId);
  if (!row) return { ok: false, error: "That section is not on one of this opportunity's proposals." };
  if ((row.dueDate ?? null) === (input.dueDate ?? null)) return { ok: true, id: row.id };
  await db.update(proposalSections).set({ dueDate: input.dueDate, updatedAt: new Date() }).where(and(eq(proposalSections.id, row.id), eq(proposalSections.proposalId, row.proposalId)));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "proposal.section.due_date.set",
    resourceType: "proposal_section",
    resourceId: row.id,
    metadata: { opportunityId, proposalId: row.proposalId, title: row.title, before: row.dueDate, after: input.dueDate, authorUserId: row.authorUserId },
  });
  return { ok: true, id: row.id };
}

/** A tenant created after migration 0164 gets the default rule the first time a part of its falls overdue. */
export async function ensureSectionOverdueDefaultRule(organizationId: string): Promise<void> {
  const [any] = await db
    .select({ id: notificationRules.id })
    .from(notificationRules)
    .where(and(eq(notificationRules.organizationId, organizationId), eq(notificationRules.triggerEventKind, "proposal_section_overdue")))
    .limit(1);
  if (any) return;
  await db.insert(notificationRules).values({
    organizationId,
    name: "Default: Proposal section overdue",
    description: "The day after a proposal section's due date passes with no draft written, its owner is told once in the inbox and by email.",
    triggerEventKind: "proposal_section_overdue",
    recipientStrategy: "mentioned_in_payload",
    channels: ["in_app", "email"],
    frequency: "immediate",
  });
}
