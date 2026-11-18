import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inboundEmails, opportunities, proposalReviewAssignments, proposalReviews, proposalSubmissions, proposals, users } from "@/db/schema";
import { deliveredSummary, READY_PROPOSAL_STAGES, readySignoffLine, type DeliveredReply, type DeliveredSent, type DeliveredSummary, type SignoffRound } from "@/lib/deliver-logic";
import { lifecycleStage } from "@/lib/lifecycle";

/**
 * BL-NAV-LIFECYCLE 6d-2 — the two lists of Pipeline → Deliver (design
 * §2.6). Ready to deliver: opportunities still in Develop whose newest
 * proposal is at Gold or White Gloves, with the colour teams' sign-off
 * line. Delivered: what each submitted opportunity's newest submission
 * and replies say. Every query is batched over the list and scoped by
 * the organization; review rounds and assignments carry no
 * organization_id, so they join the proposal. Callers own the auth gate.
 */

export type ReadyRow = {
  id: string;
  title: string;
  agency: string | null;
  solicitationNumber: string | null;
  owner: string | null;
  responseDueDate: string | null;
  proposalStage: (typeof READY_PROPOSAL_STAGES)[number];
  signoffLine: string;
};

export async function readyToDeliver(organizationId: string): Promise<ReadyRow[]> {
  const develop = lifecycleStage("develop")?.lists ?? [];
  if (develop.length === 0) return [];
  const rows = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      responseDueDate: opportunities.responseDueDate,
      ownerName: users.name,
      ownerEmail: users.email,
      proposalId: proposals.id,
      proposalStage: proposals.stage,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .leftJoin(users, eq(users.id, opportunities.ownerUserId))
    .where(and(eq(proposals.organizationId, organizationId), eq(opportunities.organizationId, organizationId), inArray(opportunities.stage, develop)))
    .orderBy(asc(opportunities.responseDueDate), asc(opportunities.title), asc(proposals.createdAt));
  // The newest proposal of each opportunity decides (as on the Deliver tab); rows arrive oldest proposal first.
  const newest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) newest.set(r.id, r);
  const ready = [...newest.values()].filter((r) => (READY_PROPOSAL_STAGES as readonly string[]).includes(r.proposalStage));
  const rounds = await roundsByProposal(organizationId, ready.map((r) => r.proposalId));
  return ready.map((r) => ({
    id: r.id,
    title: r.title,
    agency: r.agency,
    solicitationNumber: r.solicitationNumber,
    owner: r.ownerName ?? r.ownerEmail ?? null,
    responseDueDate: r.responseDueDate ? r.responseDueDate.toISOString() : null,
    proposalStage: r.proposalStage as ReadyRow["proposalStage"],
    signoffLine: readySignoffLine(rounds.get(r.proposalId) ?? []),
  }));
}

/** Each proposal's review rounds with their reviewers' verdicts: two queries for the whole list. */
async function roundsByProposal(organizationId: string, proposalIds: string[]): Promise<Map<string, SignoffRound[]>> {
  const out = new Map<string, SignoffRound[]>();
  if (proposalIds.length === 0) return out;
  const rounds = await db
    .select({ id: proposalReviews.id, proposalId: proposalReviews.proposalId, color: proposalReviews.color, status: proposalReviews.status, verdict: proposalReviews.verdict, createdAt: proposalReviews.createdAt })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposals.organizationId, organizationId), inArray(proposalReviews.proposalId, proposalIds)));
  const ids = rounds.map((r) => r.id);
  const assignments = ids.length
    ? await db
        .select({ reviewId: proposalReviewAssignments.reviewId, verdict: proposalReviewAssignments.verdict, submittedAt: proposalReviewAssignments.submittedAt })
        .from(proposalReviewAssignments)
        .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewAssignments.reviewId))
        .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
        .where(and(eq(proposals.organizationId, organizationId), inArray(proposalReviewAssignments.reviewId, ids)))
    : [];
  for (const r of rounds) {
    const list = out.get(r.proposalId) ?? [];
    list.push({ id: r.id, color: r.color, status: r.status, verdict: r.verdict, createdAt: r.createdAt, reviewers: assignments.filter((a) => a.reviewId === r.id).map((a) => ({ verdict: a.verdict, submitted: a.submittedAt !== null })) });
    out.set(r.proposalId, list);
  }
  return out;
}

/** The Delivered list's line per opportunity: two queries for the whole list. Opportunities of another tenant get no entry. */
export async function deliveredSummaries(organizationId: string, opportunityIds: string[]): Promise<Map<string, DeliveredSummary>> {
  const out = new Map<string, DeliveredSummary>();
  if (opportunityIds.length === 0) return out;
  const [sent, replies] = await Promise.all([
    db
      .select({ opportunityId: proposalSubmissions.opportunityId, method: proposalSubmissions.method, status: proposalSubmissions.status, sentAt: proposalSubmissions.sentAt, recipients: proposalSubmissions.recipientsTo, inReplyToEmailId: proposalSubmissions.inReplyToEmailId })
      .from(proposalSubmissions)
      .where(and(eq(proposalSubmissions.organizationId, organizationId), inArray(proposalSubmissions.opportunityId, opportunityIds))),
    db
      .select({ opportunityId: inboundEmails.opportunityId, type: inboundEmails.replyType, status: inboundEmails.status, receivedAt: inboundEmails.receivedAt })
      .from(inboundEmails)
      .where(and(eq(inboundEmails.organizationId, organizationId), inArray(inboundEmails.opportunityId, opportunityIds), eq(inboundEmails.kind, "proposal_reply"))),
  ]);
  const sentBy = new Map<string, DeliveredSent[]>();
  for (const s of sent) sentBy.set(s.opportunityId, [...(sentBy.get(s.opportunityId) ?? []), { method: s.method, status: s.status, sentAt: s.sentAt, recipients: s.recipients ?? [], isAnswer: s.inReplyToEmailId !== null }]);
  const repliesBy = new Map<string, DeliveredReply[]>();
  for (const r of replies) if (r.opportunityId) repliesBy.set(r.opportunityId, [...(repliesBy.get(r.opportunityId) ?? []), { type: r.type, receivedAt: r.receivedAt, read: r.status === "parsed" }]);
  for (const id of new Set([...sentBy.keys(), ...repliesBy.keys()])) out.set(id, deliveredSummary(sentBy.get(id) ?? [], repliesBy.get(id) ?? []));
  return out;
}
