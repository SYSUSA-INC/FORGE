import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  customerContacts,
  opportunities,
  opportunityActivities,
  organizations,
  proposalPdfRenders,
  proposalReviewAssignments,
  proposalReviewChecklistItems,
  proposalReviews,
  proposalSubmissions,
  proposals,
  solicitations,
  users,
  type ProposalStage,
  type ProposalSubmissionFile,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { getComplianceGateStatus } from "@/lib/compliance-gate";
import { agencyKey } from "@/lib/crm-logic";
import {
  canOverride,
  canSubmit,
  defaultSendSubject,
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
import { emailConfigured } from "@/lib/email";
import { inboundDomain } from "@/lib/inbound-email-logic";
import { runDurable } from "@/lib/jobs";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { applyOpportunityStage } from "@/lib/opportunity-stage";
import { mergeLmStructures } from "@/lib/solicitation-lm";
import { getStorageProvider } from "@/lib/storage";

/**
 * BL-NAV-LIFECYCLE 6a (FORGE II S-1, S-2) — Deliver's store: the
 * sign-off gate read from the review rounds, the renders a submission
 * can carry, the submissions on record, and Record submission (the lead
 * sent the file themselves). Review rounds, assignments and checklist
 * ticks carry no organization_id, so every query joins the proposal and
 * filters on the organization. Callers own the auth gate. Design:
 * docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.1 to §2.3. Sending
 * from the portal (6b, §2.4) is in deliver-send.ts and ends in the same
 * `markDelivered`.
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
  cc: string[];
  subject: string;
  /** Why a send from FORGE did not leave; empty otherwise. */
  error: string;
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
  /** Send from FORGE (6b): whether it is set up, and what the form starts with. */
  send: {
    configured: boolean;
    defaultSubject: string;
    senderEmail: string;
    /** The agency's contracting officers from Customers, as suggestions for To. */
    suggestions: { name: string; title: string; email: string }[];
    /** The RFP's own submission rules (Section L), quoted. */
    rules: { rule: string; quote: string }[];
  };
};

/** Sending needs the mail provider's key and the inbound domain the opportunity's address lives on. */
export function sendConfigured(): boolean {
  return emailConfigured() && inboundDomain() !== null;
}

const SUBMISSION_PACK_KEY = "submission_pack";

/** The newest proposal of the opportunity with its leads, or null. */
export async function proposalOf(organizationId: string, opportunityId: string) {
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
export async function rendersOf(organizationId: string, proposalId: string) {
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
      recipientsCc: proposalSubmissions.recipientsCc,
      subject: proposalSubmissions.subject,
      error: proposalSubmissions.error,
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
    cc: r.recipientsCc ?? [],
    subject: r.subject,
    error: r.error,
    note: r.note,
    overrideReason: r.overrideReason,
    files: (r.files ?? []).map((f) => ({ fileName: f.fileName, byteSize: f.byteSize, sha256: f.sha256 })),
  }));
}

/** The Deliver tab's view; null when the opportunity is not the tenant's. */
export async function loadDeliver(input: { organizationId: string; opportunityId: string; user: DeliverUser }): Promise<DeliverView | null> {
  const { organizationId, opportunityId, user } = input;
  const [opp] = await db
    .select({ title: opportunities.title, responseDueDate: opportunities.responseDueDate, agency: opportunities.agency, solicitationNumber: opportunities.solicitationNumber })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return null;
  const proposal = await proposalOf(organizationId, opportunityId);
  const key = agencyKey(opp.agency);
  const [gate, renders, submissions, [org], contacts, sols] = await Promise.all([
    proposal ? signoffFor(organizationId, proposal.id) : Promise.resolve(null),
    proposal ? rendersOf(organizationId, proposal.id) : Promise.resolve([]),
    listSubmissions(organizationId, opportunityId),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    key
      ? db
          .select({ name: customerContacts.name, title: customerContacts.title, email: customerContacts.email })
          .from(customerContacts)
          .where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.agencyKey, key), eq(customerContacts.role, "contracting_officer")))
          .limit(10)
      : Promise.resolve([]),
    db
      .select({ lmStructure: solicitations.lmStructure })
      .from(solicitations)
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId)))
      .orderBy(desc(solicitations.createdAt))
      .limit(5),
  ]);
  const rules = mergeLmStructures(sols.map((x) => x.lmStructure)).sectionL?.submission ?? [];
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
    send: {
      configured: sendConfigured(),
      defaultSubject: defaultSendSubject({ solicitationNumber: opp.solicitationNumber, title: proposal?.title ?? opp.title, companyName: org?.name ?? "" }),
      senderEmail: user.email ?? "",
      suggestions: contacts.filter((c) => c.email.trim() !== ""),
      rules: rules.map((r) => ({ rule: r.rule, quote: r.quote })),
    },
  };
}

type ProposalWithLeads = NonNullable<Awaited<ReturnType<typeof proposalOf>>>;

export type SubmissionContext = { proposal: ProposalWithLeads; gate: SignoffGate; overridden: boolean; reason: string };

/**
 * What both ways of submitting check first: the opportunity is the
 * tenant's, it has a proposal, the person may submit, and the sign-off
 * gate is clear or overridden with a reason by someone who may.
 */
export async function submissionContext(input: {
  organizationId: string;
  opportunityId: string;
  user: DeliverUser;
  overrideReason?: string;
  verb: "record" | "send";
}): Promise<({ ok: true } & SubmissionContext) | { ok: false; error: string }> {
  const { organizationId, opportunityId, user } = input;
  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const proposal = await proposalOf(organizationId, opportunityId);
  if (!proposal) return { ok: false, error: "This opportunity has no proposal yet. Create a draft on the Develop tab first." };
  if (!canSubmit(user, proposal)) return { ok: false, error: `Only an org admin, the proposal manager or the capture manager can ${input.verb} a submission.` };
  const gate = await signoffFor(organizationId, proposal.id);
  const reason = String(input.overrideReason ?? "").trim().slice(0, 1000);
  if (!gate.clear) {
    if (reason.length < OVERRIDE_REASON_MIN) return { ok: false, error: `Sign-off is not complete. ${gate.blockers.join(" ")}` };
    if (!canOverride(user, proposal)) return { ok: false, error: "Only an org admin or the proposal manager can submit before every colour team has signed off." };
  }
  return { ok: true, proposal, gate, overridden: !gate.clear, reason: gate.clear ? "" : reason };
}

/** The audit row of a gate override, written when the submission row is. */
export async function auditGateOverride(i: { organizationId: string; opportunityId: string; submissionId: string; actor: { userId: string | null; email?: string | null }; ctx: SubmissionContext }): Promise<void> {
  if (!i.ctx.overridden) return;
  await recordAudit({
    organizationId: i.organizationId,
    actor: i.actor,
    action: "proposal.submission.gate_override",
    resourceType: "proposal",
    resourceId: i.ctx.proposal.id,
    metadata: { submissionId: i.submissionId, opportunityId: i.opportunityId, reason: i.ctx.reason, blockers: i.ctx.gate.blockers, signedOff: i.ctx.gate.signedOff },
  });
}

/**
 * The one act that marks delivery, for both ways of submitting (design
 * §2.2): the proposal and the opportunity become submitted, the timeline
 * and the audit log say so, the notification event is raised and the
 * harvest starts the first time.
 */
export async function markDelivered(d: {
  organizationId: string;
  opportunityId: string;
  submissionId: string;
  proposalId: string;
  actor: { userId: string | null; email?: string | null };
  method: keyof typeof SUBMISSION_METHOD_LABELS;
  sentAt: Date;
  now: Date;
  recipients: string[];
  note: string;
  files: ProposalSubmissionFile[];
  overridden: boolean;
  auditAction: "proposal.submission.recorded" | "proposal.submission.sent";
  auditMetadata: Record<string, unknown>;
}): Promise<void> {
  const { organizationId, opportunityId, submissionId, proposalId, actor, method } = d;
  const [proposal] = await db
    .select({ title: proposals.title, stage: proposals.stage })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!proposal) return;
  const first = d.files[0];
  await db
    .update(proposals)
    .set({ stage: "submitted", submittedAt: d.sentAt, updatedAt: d.now })
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
  await applyOpportunityStage({ organizationId, opportunityId, stage: "submitted", actor, source: "submission" });
  await db.insert(opportunityActivities).values({
    opportunityId,
    userId: actor.userId,
    kind: "submission",
    title: `Proposal submitted: ${SUBMISSION_METHOD_LABELS[method].toLowerCase()}`,
    body: [d.recipients.length ? `To ${d.recipients.join(", ")}.` : "", d.note].filter(Boolean).join(" "),
    metadata: { submissionId, proposalId, method, sentAt: d.sentAt.toISOString(), fileName: first?.fileName ?? "", sha256: first?.sha256 ?? "", overridden: d.overridden },
  });
  await recordAudit({
    organizationId,
    actor,
    action: d.auditAction,
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: { submissionId, opportunityId, method, sentAt: d.sentAt.toISOString(), recipients: d.recipients, ...d.auditMetadata, overridden: d.overridden, fromStage: proposal.stage },
  });

  // Best-effort: a dispatcher failure must not undo the submission.
  try {
    await dispatchTriggerEvent({
      organizationId,
      kind: "proposal_submitted",
      payload: { proposalId, opportunityId, submissionId, method },
      subject: `Proposal submitted: ${proposal.title}`,
      linkPath: `/opportunities/${opportunityId}/deliver`,
      proposalId,
      actorUserId: actor.userId ?? undefined,
    });
  } catch (err) {
    log.warn("[markDelivered]", "proposal_submitted dispatch failed", { error: err });
  }
  // As Advance to Submitted did: harvest into the corpus the first time the proposal is submitted.
  if (proposal.stage !== "submitted") {
    try {
      await runDurable("[markDelivered] harvest", { organizationId, kind: "proposal_harvest", resourceId: proposalId, requestedByUserId: actor.userId });
    } catch (err) {
      log.warn("[markDelivered]", "harvest did not start", { error: err });
    }
  }
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
  const ctx = await submissionContext({ organizationId, opportunityId, user, overrideReason: input.overrideReason, verb: "record" });
  if (!ctx.ok) return ctx;
  const { proposal, gate, overridden, reason } = ctx;

  if (!(RECORD_METHODS as readonly string[]).includes(input.method)) return { ok: false, error: "Choose how the proposal was submitted." };
  const method = input.method as RecordMethod;
  const sentAt = parseSentAt(input.sentAt, now);
  if (!sentAt) return { ok: false, error: "Enter when it was submitted: a date and time that is not in the future." };
  const recipients = parseRecipients(input.recipients);
  if (!recipients.ok) return recipients;
  if (method === "own_email" && recipients.list.length === 0) return { ok: false, error: "Enter the address the proposal was emailed to." };
  const note = String(input.note ?? "").trim().slice(0, 2000);

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
  await auditGateOverride({ organizationId, opportunityId, submissionId, actor, ctx });
  await markDelivered({
    organizationId,
    opportunityId,
    submissionId,
    proposalId: proposal.id,
    actor,
    method,
    sentAt,
    now,
    recipients: recipients.list,
    note,
    files: [file],
    overridden,
    auditAction: "proposal.submission.recorded",
    auditMetadata: { renderId: render.id, fileName, byteSize: file.byteSize, sha256: file.sha256, signedOff: gate.signedOff },
  });
  return { ok: true, submissionId, overridden };
}
