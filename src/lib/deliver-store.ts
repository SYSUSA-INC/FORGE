import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  proposalPdfRenders,
  proposalReviewAssignments,
  proposalReviewChecklistItems,
  proposalReviews,
  proposalSubmissions,
  proposals,
  users,
  type ProposalStage,
  type ProposalSubmissionFile,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { getComplianceGateStatus } from "@/lib/compliance-gate";
import {
  canOverride,
  canSubmit,
  OVERRIDE_REASON_MIN,
  parseRecipients,
  parseSentAt,
  RECORD_METHODS,
  signoffGate,
  snapshotOf,
  submissionFileName,
  SUBMISSION_METHOD_LABELS,
  type RecordMethod,
  type SignoffGate,
  type SignoffRound,
} from "@/lib/deliver-logic";
import { runDurable } from "@/lib/jobs";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { applyOpportunityStage } from "@/lib/opportunity-stage";
import { getStorageProvider } from "@/lib/storage";

/**
 * BL-NAV-LIFECYCLE 6a (FORGE II S-1, S-2) — Deliver's store: the
 * sign-off gate read from the review rounds, the renders a submission
 * can carry, the submissions on record, and Record submission (the lead
 * sent the file themselves). Review rounds, assignments and checklist
 * ticks carry no organization_id, so every query joins the proposal and
 * filters on the organization. Callers own the auth gate. Design:
 * docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.1 to §2.3.
 */

export type DeliverUser = { id: string; email?: string | null; name?: string | null; role: string | null; isSuperadmin: boolean };

export type DeliverRender = { id: string; contentType: string; byteSize: number; pageCount: number; renderedAt: string };

export type DeliverSubmission = {
  id: string;
  method: keyof typeof SUBMISSION_METHOD_LABELS;
  status: string;
  sentAt: string | null;
  sentBy: string;
  recipients: string[];
  note: string;
  overrideReason: string;
  files: { fileName: string; byteSize: number; sha256: string }[];
};

export type DeliverView = {
  opportunityId: string;
  opportunityTitle: string;
  dueDate: string | null;
  proposal: { id: string; title: string; stage: ProposalStage; submittedAt: string | null } | null;
  gate: SignoffGate | null;
  renders: DeliverRender[];
  submissions: DeliverSubmission[];
  canSubmit: boolean;
  canOverride: boolean;
};

const SUBMISSION_PACK_KEY = "submission_pack";

/** The newest proposal of the opportunity with its leads, or null. */
async function proposalOf(organizationId: string, opportunityId: string) {
  const [row] = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      stage: proposals.stage,
      submittedAt: proposals.submittedAt,
      proposalManagerUserId: proposals.proposalManagerUserId,
      captureManagerUserId: proposals.captureManagerUserId,
    })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)))
    .orderBy(desc(proposals.createdAt))
    .limit(1);
  return row ?? null;
}

/** The sign-off gate of one proposal: the rounds with their reviewers, the submission-pack tick, the export gate. */
export async function signoffFor(organizationId: string, proposalId: string): Promise<SignoffGate> {
  const rounds = await db
    .select({ id: proposalReviews.id, color: proposalReviews.color, status: proposalReviews.status, verdict: proposalReviews.verdict, createdAt: proposalReviews.createdAt })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposals.organizationId, organizationId), eq(proposalReviews.proposalId, proposalId)));
  const ids = rounds.map((r) => r.id);
  const [assignments, ticks, exportGate] = await Promise.all([
    ids.length
      ? db
          .select({ reviewId: proposalReviewAssignments.reviewId, verdict: proposalReviewAssignments.verdict, submittedAt: proposalReviewAssignments.submittedAt })
          .from(proposalReviewAssignments)
          .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewAssignments.reviewId))
          .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
          .where(and(eq(proposals.organizationId, organizationId), inArray(proposalReviewAssignments.reviewId, ids)))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ reviewId: proposalReviewChecklistItems.reviewId })
          .from(proposalReviewChecklistItems)
          .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewChecklistItems.reviewId))
          .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
          .where(
            and(
              eq(proposals.organizationId, organizationId),
              inArray(proposalReviewChecklistItems.reviewId, ids),
              eq(proposalReviewChecklistItems.itemKey, SUBMISSION_PACK_KEY),
              eq(proposalReviewChecklistItems.checked, true),
            ),
          )
      : Promise.resolve([]),
    getComplianceGateStatus(proposalId, organizationId),
  ]);
  const input: SignoffRound[] = rounds.map((r) => ({
    ...r,
    reviewers: assignments.filter((a) => a.reviewId === r.id).map((a) => ({ verdict: a.verdict, submitted: a.submittedAt !== null })),
  }));
  // The pack counts when a reviewer ticked it on the newest White Gloves round.
  const newestWhiteGloves = input.filter((r) => r.color === "white_gloves" && r.status !== "cancelled").sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const submissionPackTicked = !!newestWhiteGloves && ticks.some((t) => t.reviewId === newestWhiteGloves.id);
  return signoffGate({ rounds: input, submissionPackTicked, exportBlocked: exportGate.blocked });
}

/** The renders a submission can carry: real PDF and DOCX files, newest first (stub renders have no file). */
async function rendersOf(organizationId: string, proposalId: string) {
  const rows = await db
    .select({
      id: proposalPdfRenders.id,
      storagePath: proposalPdfRenders.storagePath,
      contentType: proposalPdfRenders.contentType,
      byteSize: proposalPdfRenders.byteSize,
      pageCount: proposalPdfRenders.pageCount,
      renderedAt: proposalPdfRenders.renderedAt,
    })
    .from(proposalPdfRenders)
    .where(and(eq(proposalPdfRenders.organizationId, organizationId), eq(proposalPdfRenders.proposalId, proposalId)))
    .orderBy(desc(proposalPdfRenders.renderedAt))
    .limit(20);
  return rows.filter((r) => (r.contentType === "pdf" || r.contentType === "docx") && !r.storagePath.startsWith("stub:"));
}

/** The opportunity's submissions, newest first. */
export async function listSubmissions(organizationId: string, opportunityId: string): Promise<DeliverSubmission[]> {
  const rows = await db
    .select({
      id: proposalSubmissions.id,
      method: proposalSubmissions.method,
      status: proposalSubmissions.status,
      sentAt: proposalSubmissions.sentAt,
      recipientsTo: proposalSubmissions.recipientsTo,
      note: proposalSubmissions.note,
      overrideReason: proposalSubmissions.overrideReason,
      files: proposalSubmissions.files,
      senderName: users.name,
      senderEmail: users.email,
    })
    .from(proposalSubmissions)
    .leftJoin(users, eq(users.id, proposalSubmissions.sentByUserId))
    .where(and(eq(proposalSubmissions.organizationId, organizationId), eq(proposalSubmissions.opportunityId, opportunityId)))
    .orderBy(desc(proposalSubmissions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    status: r.status,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    sentBy: r.senderName || r.senderEmail || "A former member",
    recipients: r.recipientsTo ?? [],
    note: r.note,
    overrideReason: r.overrideReason,
    files: (r.files ?? []).map((f) => ({ fileName: f.fileName, byteSize: f.byteSize, sha256: f.sha256 })),
  }));
}

/** The Deliver tab's view; null when the opportunity is not the tenant's. */
export async function loadDeliver(input: { organizationId: string; opportunityId: string; user: DeliverUser }): Promise<DeliverView | null> {
  const { organizationId, opportunityId, user } = input;
  const [opp] = await db
    .select({ title: opportunities.title, responseDueDate: opportunities.responseDueDate })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return null;
  const proposal = await proposalOf(organizationId, opportunityId);
  const [gate, renders, submissions] = await Promise.all([
    proposal ? signoffFor(organizationId, proposal.id) : Promise.resolve(null),
    proposal ? rendersOf(organizationId, proposal.id) : Promise.resolve([]),
    listSubmissions(organizationId, opportunityId),
  ]);
  return {
    opportunityId,
    opportunityTitle: opp.title,
    dueDate: opp.responseDueDate ? opp.responseDueDate.toISOString().slice(0, 10) : null,
    proposal: proposal ? { id: proposal.id, title: proposal.title, stage: proposal.stage, submittedAt: proposal.submittedAt ? proposal.submittedAt.toISOString() : null } : null,
    gate,
    renders: renders.map((r) => ({ id: r.id, contentType: r.contentType, byteSize: r.byteSize, pageCount: r.pageCount, renderedAt: r.renderedAt.toISOString() })),
    submissions,
    canSubmit: !!proposal && canSubmit(user, proposal),
    canOverride: !!proposal && canOverride(user, proposal),
  };
}

export type RecordSubmissionInput = {
  organizationId: string;
  opportunityId: string;
  user: DeliverUser;
  method: string;
  /** When the lead sent it, ISO. */
  sentAt: string;
  /** Who it went to: addresses separated by commas or spaces; may be empty for a portal upload. */
  recipients: string;
  note: string;
  /** The render that was sent. */
  renderId: string;
  /** Needed, ten characters or more, when the sign-off gate is not clear. */
  overrideReason?: string;
  now?: Date;
};

export type RecordSubmissionResult = { ok: true; submissionId: string; overridden: boolean } | { ok: false; error: string };

/**
 * Option 1 (S-2): the lead submitted the file themselves, and records it.
 * Keeps a copy of the file with its SHA-256, writes the submission, marks
 * the proposal and the opportunity submitted, puts it on the opportunity's
 * timeline, audits, notifies and starts the harvest. The one act that
 * marks delivery.
 */
export async function recordSubmission(input: RecordSubmissionInput): Promise<RecordSubmissionResult> {
  const { organizationId, opportunityId, user } = input;
  const now = input.now ?? new Date();
  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const proposal = await proposalOf(organizationId, opportunityId);
  if (!proposal) return { ok: false, error: "This opportunity has no proposal yet. Create a draft on the Develop tab first." };
  if (!canSubmit(user, proposal)) return { ok: false, error: "Only an org admin, the proposal manager or the capture manager can record a submission." };

  if (!(RECORD_METHODS as readonly string[]).includes(input.method)) return { ok: false, error: "Choose how the proposal was submitted." };
  const method = input.method as RecordMethod;
  const sentAt = parseSentAt(input.sentAt, now);
  if (!sentAt) return { ok: false, error: "Enter when it was submitted: a date and time that is not in the future." };
  const recipients = parseRecipients(input.recipients);
  if (!recipients.ok) return recipients;
  if (method === "own_email" && recipients.list.length === 0) return { ok: false, error: "Enter the address the proposal was emailed to." };
  const note = String(input.note ?? "").trim().slice(0, 2000);

  const gate = await signoffFor(organizationId, proposal.id);
  const reason = String(input.overrideReason ?? "").trim().slice(0, 1000);
  if (!gate.clear) {
    if (reason.length < OVERRIDE_REASON_MIN) return { ok: false, error: `Sign-off is not complete. ${gate.blockers.join(" ")}` };
    if (!canOverride(user, proposal)) return { ok: false, error: "Only an org admin or the proposal manager can submit before every colour team has signed off." };
  }
  const overridden = !gate.clear;

  const render = (await rendersOf(organizationId, proposal.id)).find((r) => r.id === String(input.renderId ?? ""));
  if (!render) return { ok: false, error: "Choose the file that was submitted." };
  const storage = getStorageProvider();
  const object = await storage.get(render.storagePath);
  if (!object) return { ok: false, error: "That file is no longer in storage. Render the proposal again and choose the new file." };

  const submissionId = randomUUID();
  const fileName = submissionFileName(proposal.title, render.contentType);
  const file: ProposalSubmissionFile = {
    renderId: render.id,
    fileName,
    storagePath: `org/${organizationId}/submission/${submissionId}/${fileName}`,
    contentType: object.contentType,
    byteSize: object.bytes.byteLength,
    sha256: createHash("sha256").update(object.bytes).digest("hex"),
  };
  await storage.put({ key: file.storagePath, bytes: object.bytes, contentType: object.contentType });

  await db.insert(proposalSubmissions).values({
    id: submissionId,
    organizationId,
    opportunityId,
    proposalId: proposal.id,
    method,
    status: "recorded",
    recipientsTo: recipients.list,
    note,
    files: [file],
    signoff: snapshotOf(gate),
    overrideReason: overridden ? reason : "",
    sentAt,
    sentByUserId: user.id,
  });

  const actor = { userId: user.id, email: user.email };
  if (overridden) {
    await recordAudit({
      organizationId,
      actor,
      action: "proposal.submission.gate_override",
      resourceType: "proposal",
      resourceId: proposal.id,
      metadata: { submissionId, opportunityId, reason, blockers: gate.blockers, signedOff: gate.signedOff },
    });
  }

  const wasSubmitted = proposal.stage === "submitted";
  await db
    .update(proposals)
    .set({ stage: "submitted", submittedAt: sentAt, updatedAt: now })
    .where(and(eq(proposals.id, proposal.id), eq(proposals.organizationId, organizationId)));
  await applyOpportunityStage({ organizationId, opportunityId, stage: "submitted", actor, source: "submission" });
  await db.insert(opportunityActivities).values({
    opportunityId,
    userId: user.id,
    kind: "submission",
    title: `Proposal submitted: ${SUBMISSION_METHOD_LABELS[method].toLowerCase()}`,
    body: [recipients.list.length ? `To ${recipients.list.join(", ")}.` : "", note].filter(Boolean).join(" "),
    metadata: { submissionId, proposalId: proposal.id, method, sentAt: sentAt.toISOString(), fileName, sha256: file.sha256, overridden },
  });
  await recordAudit({
    organizationId,
    actor,
    action: "proposal.submission.recorded",
    resourceType: "proposal",
    resourceId: proposal.id,
    metadata: {
      submissionId,
      opportunityId,
      method,
      sentAt: sentAt.toISOString(),
      recipients: recipients.list,
      renderId: render.id,
      fileName,
      byteSize: file.byteSize,
      sha256: file.sha256,
      signedOff: gate.signedOff,
      overridden,
      fromStage: proposal.stage,
    },
  });

  // Best-effort: a dispatcher failure must not undo the submission.
  try {
    await dispatchTriggerEvent({
      organizationId,
      kind: "proposal_submitted",
      payload: { proposalId: proposal.id, opportunityId, submissionId, method },
      subject: `Proposal submitted: ${proposal.title}`,
      linkPath: `/opportunities/${opportunityId}/deliver`,
      proposalId: proposal.id,
      actorUserId: user.id,
    });
  } catch (err) {
    log.warn("[recordSubmission]", "proposal_submitted dispatch failed", { error: err });
  }
  // As Advance to Submitted did: harvest into the corpus the first time the proposal is submitted.
  if (!wasSubmitted) {
    try {
      await runDurable("[recordSubmission] harvest", { organizationId, kind: "proposal_harvest", resourceId: proposal.id, requestedByUserId: user.id });
    } catch (err) {
      log.warn("[recordSubmission]", "harvest did not start", { error: err });
    }
  }
  return { ok: true, submissionId, overridden };
}
