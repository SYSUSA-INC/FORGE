import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { companies, opportunities, opportunityCapabilityMatrices, opportunityPartnerInvites, opportunityPartners, notifications, organizations, users } from "@/db/schema";
import { appBaseUrl } from "@/lib/app-url";
import { recordAudit, recordRead } from "@/lib/audit-log";
import { emailConfigured, sendPartnerInviteEmail } from "@/lib/email";
import { log } from "@/lib/log";
import {
  certificationLabels,
  inviteState,
  normalizeCertifications,
  normalizeInviteEmail,
  normalizePartnerAnswers,
  partnerAnswerSummary,
  partnerInviteExpiry,
  partnerQuestionsOf,
  type InviteState,
  type PartnerAnswers,
  type PartnerAnswerSummary,
  type PartnerCertifications,
  type PartnerQuestion,
} from "@/lib/partner-invite-logic";

/**
 * BL-NAV-LIFECYCLE phase 3c — partner invites and the partner's own
 * answers. Callers of the organization-side functions own auth and pass
 * `organizationId` from the session; the token functions have no session:
 * the unguessable link is the credential, and the row it finds carries the
 * organization every later query is scoped by.
 */
type Actor = { userId: string; email?: string | null };

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function partnerInviteLink(raw: string): string {
  return `${appBaseUrl()}/partner/${encodeURIComponent(raw)}`;
}

export type PartnerInviteView = { email: string; contactName: string; expiresAt: string; emailed: boolean; openedAt: string | null; submittedAt: string | null; state: InviteState };

/** The latest invite per partner of the opportunity. */
export async function listPartnerInvites(organizationId: string, opportunityId: string): Promise<Map<string, PartnerInviteView>> {
  const rows = await db
    .select({
      partnerId: opportunityPartnerInvites.partnerId,
      email: opportunityPartnerInvites.email,
      contactName: opportunityPartnerInvites.contactName,
      expiresAt: opportunityPartnerInvites.expiresAt,
      emailedAt: opportunityPartnerInvites.emailedAt,
      openedAt: opportunityPartnerInvites.openedAt,
      submittedAt: opportunityPartnerInvites.submittedAt,
    })
    .from(opportunityPartnerInvites)
    .where(and(eq(opportunityPartnerInvites.organizationId, organizationId), eq(opportunityPartnerInvites.opportunityId, opportunityId)))
    .orderBy(desc(opportunityPartnerInvites.createdAt));
  const now = new Date();
  const out = new Map<string, PartnerInviteView>();
  for (const r of rows) {
    if (out.has(r.partnerId)) continue;
    out.set(r.partnerId, {
      email: r.email,
      contactName: r.contactName,
      expiresAt: r.expiresAt.toISOString(),
      emailed: r.emailedAt !== null,
      openedAt: r.openedAt?.toISOString() ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      state: inviteState(r, now),
    });
  }
  return out;
}

export type InviteResult = { ok: true; link: string; emailed: boolean; expiresAt: string } | { ok: false; error: string };

/**
 * Invite a partner's contact to answer the matrix: a fresh personal link
 * (14 days) replaces the partner's earlier unanswered invites, the
 * partner becomes `invited` unless already chosen, and the contact is
 * emailed when email is configured. The link comes back either way, for
 * Copy link.
 */
export async function invitePartner(input: { organizationId: string; opportunityId: string; partnerId: string; email: unknown; contactName?: unknown; actor: Actor }): Promise<InviteResult> {
  const { organizationId, opportunityId } = input;
  const email = normalizeInviteEmail(input.email);
  if (!email) return { ok: false, error: "Enter the contact's email address." };
  const contactName = typeof input.contactName === "string" ? input.contactName.trim().slice(0, 120) : "";
  const [row] = await db
    .select({ id: opportunityPartners.id, status: opportunityPartners.status, company: companies.name, opportunityTitle: opportunities.title, orgName: organizations.name })
    .from(opportunityPartners)
    .innerJoin(companies, and(eq(companies.id, opportunityPartners.companyId), eq(companies.organizationId, organizationId)))
    .innerJoin(opportunities, and(eq(opportunities.id, opportunityPartners.opportunityId), eq(opportunities.organizationId, organizationId)))
    .innerJoin(organizations, eq(organizations.id, organizationId))
    .where(and(eq(opportunityPartners.id, input.partnerId), eq(opportunityPartners.organizationId, organizationId), eq(opportunityPartners.opportunityId, opportunityId)))
    .limit(1);
  if (!row) return { ok: false, error: "Partner not found on this opportunity." };
  const [matrix] = await db
    .select({ id: opportunityCapabilityMatrices.id })
    .from(opportunityCapabilityMatrices)
    .where(and(eq(opportunityCapabilityMatrices.opportunityId, opportunityId), eq(opportunityCapabilityMatrices.organizationId, organizationId)))
    .limit(1);
  if (!matrix) return { ok: false, error: "Build the capability questions under Evaluate first; the partner answers those." };
  const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.actor.userId)).limit(1);

  const now = new Date();
  const raw = randomBytes(24).toString("base64url");
  const expiresAt = partnerInviteExpiry(now);
  await db
    .delete(opportunityPartnerInvites)
    .where(and(eq(opportunityPartnerInvites.organizationId, organizationId), eq(opportunityPartnerInvites.partnerId, row.id), isNull(opportunityPartnerInvites.submittedAt)));
  const [invite] = await db
    .insert(opportunityPartnerInvites)
    .values({ organizationId, opportunityId, partnerId: row.id, email, contactName, tokenHash: hashToken(raw), expiresAt, createdByUserId: input.actor.userId })
    .returning({ id: opportunityPartnerInvites.id });
  if (row.status === "candidate" || row.status === "declined") {
    await db.update(opportunityPartners).set({ status: "invited", updatedAt: now }).where(and(eq(opportunityPartners.id, row.id), eq(opportunityPartners.organizationId, organizationId)));
  }
  const link = partnerInviteLink(raw);
  let emailed = false;
  if (emailConfigured()) {
    try {
      await sendPartnerInviteEmail({
        to: email,
        contactName,
        companyName: row.company,
        senderName: sender?.name || input.actor.email || "A FORGE user",
        senderEmail: input.actor.email ?? "",
        organizationName: row.orgName,
        opportunityTitle: row.opportunityTitle,
        url: link,
        days: 14,
      });
      emailed = true;
      await db
        .update(opportunityPartnerInvites)
        .set({ emailedAt: new Date() })
        .where(and(eq(opportunityPartnerInvites.id, invite!.id), eq(opportunityPartnerInvites.organizationId, organizationId)));
    } catch (err) {
      log.warn("partner-invite: email failed; link still issued", err instanceof Error ? err.message : String(err));
    }
  }
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.partner.invite",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: { partnerId: row.id, company: row.company, email, emailed, expiresAt: expiresAt.toISOString() },
  });
  return { ok: true, link, emailed, expiresAt: expiresAt.toISOString() };
}

export type PartnerMatrixView = {
  state: InviteState;
  expiresAt: string;
  contactName: string;
  companyName: string;
  organizationName: string;
  opportunityTitle: string;
  questions: PartnerQuestion[];
  answers: PartnerAnswers;
  certifications: PartnerCertifications;
};

async function inviteByToken(raw: string) {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({
      id: opportunityPartnerInvites.id,
      organizationId: opportunityPartnerInvites.organizationId,
      opportunityId: opportunityPartnerInvites.opportunityId,
      partnerId: opportunityPartnerInvites.partnerId,
      email: opportunityPartnerInvites.email,
      contactName: opportunityPartnerInvites.contactName,
      expiresAt: opportunityPartnerInvites.expiresAt,
      openedAt: opportunityPartnerInvites.openedAt,
      submittedAt: opportunityPartnerInvites.submittedAt,
      createdByUserId: opportunityPartnerInvites.createdByUserId,
    })
    .from(opportunityPartnerInvites)
    .where(eq(opportunityPartnerInvites.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

/**
 * What a partner's link opens: the questions (never our answers or
 * references), its own answers and certifications. Found by the token's
 * hash; every later read is scoped by the invite's organization.
 */
export async function loadPartnerMatrixByToken(raw: string): Promise<{ ok: true; view: PartnerMatrixView } | { ok: false; error: string }> {
  const invite = await inviteByToken(raw);
  if (!invite) return { ok: false, error: "This link is not valid. Ask the sender for a new invitation." };
  const now = new Date();
  const state = inviteState(invite, now);
  if (state === "expired") return { ok: false, error: `This link expired on ${invite.expiresAt.toISOString().slice(0, 10)}. Ask the sender for a new invitation.` };
  const { organizationId, opportunityId } = invite;
  const [ctx] = await db
    .select({ company: companies.name, answers: opportunityPartners.partnerAnswers, certifications: opportunityPartners.certifications, title: opportunities.title, org: organizations.name })
    .from(opportunityPartners)
    .innerJoin(companies, eq(companies.id, opportunityPartners.companyId))
    .innerJoin(opportunities, and(eq(opportunities.id, opportunityPartners.opportunityId), eq(opportunities.organizationId, organizationId)))
    .innerJoin(organizations, eq(organizations.id, organizationId))
    .where(and(eq(opportunityPartners.id, invite.partnerId), eq(opportunityPartners.organizationId, organizationId)))
    .limit(1);
  const [matrix] = await db
    .select({ questions: opportunityCapabilityMatrices.questions })
    .from(opportunityCapabilityMatrices)
    .where(and(eq(opportunityCapabilityMatrices.opportunityId, opportunityId), eq(opportunityCapabilityMatrices.organizationId, organizationId)))
    .limit(1);
  if (!ctx || !matrix) return { ok: false, error: "This invitation no longer has an opportunity behind it." };
  if (!invite.openedAt) {
    await db
      .update(opportunityPartnerInvites)
      .set({ openedAt: now })
      .where(and(eq(opportunityPartnerInvites.id, invite.id), eq(opportunityPartnerInvites.organizationId, organizationId)));
  }
  await recordRead({ organizationId, actor: { userId: null, email: invite.email }, action: "opportunity.partner.invite.open", resourceType: "opportunity", resourceId: opportunityId, metadata: { partnerId: invite.partnerId } });
  return {
    ok: true,
    view: {
      state,
      expiresAt: invite.expiresAt.toISOString(),
      contactName: invite.contactName,
      companyName: ctx.company,
      organizationName: ctx.org,
      opportunityTitle: ctx.title,
      questions: partnerQuestionsOf(matrix.questions ?? []),
      answers: ctx.answers ?? {},
      certifications: ctx.certifications ?? {},
    },
  };
}

/**
 * Save a partner's answers and certifications (a draft, or submitted).
 * Submitting marks the partner `answered` unless it is already chosen or
 * declined; the invite stays editable until it expires.
 */
export async function savePartnerAnswersByToken(input: { token: string; answers: unknown; certifications: unknown; submit: boolean }): Promise<{ ok: true; state: InviteState } | { ok: false; error: string }> {
  const invite = await inviteByToken(input.token);
  if (!invite) return { ok: false, error: "This link is not valid." };
  const now = new Date();
  if (inviteState(invite, now) === "expired") return { ok: false, error: "This link has expired. Ask the sender for a new invitation." };
  const { organizationId, opportunityId } = invite;
  const [matrix] = await db
    .select({ questions: opportunityCapabilityMatrices.questions })
    .from(opportunityCapabilityMatrices)
    .where(and(eq(opportunityCapabilityMatrices.opportunityId, opportunityId), eq(opportunityCapabilityMatrices.organizationId, organizationId)))
    .limit(1);
  if (!matrix) return { ok: false, error: "This invitation no longer has an opportunity behind it." };
  const questions = matrix.questions ?? [];
  const answers = normalizePartnerAnswers(input.answers, questions.map((q) => q.id), now);
  const certifications = normalizeCertifications(input.certifications);
  const [partner] = await db
    .select({ id: opportunityPartners.id, status: opportunityPartners.status, name: companies.name })
    .from(opportunityPartners)
    .innerJoin(companies, and(eq(companies.id, opportunityPartners.companyId), eq(companies.organizationId, organizationId)))
    .where(and(eq(opportunityPartners.id, invite.partnerId), eq(opportunityPartners.organizationId, organizationId)))
    .limit(1);
  if (!partner) return { ok: false, error: "This invitation no longer has a partner behind it." };
  const submit = input.submit === true;
  await db
    .update(opportunityPartners)
    .set({
      partnerAnswers: answers,
      certifications,
      updatedAt: now,
      ...(submit ? { answeredAt: now } : {}),
      ...(submit && (partner.status === "candidate" || partner.status === "invited") ? { status: "answered" as const } : {}),
    })
    .where(and(eq(opportunityPartners.id, partner.id), eq(opportunityPartners.organizationId, organizationId)));
  if (submit) {
    await db
      .update(opportunityPartnerInvites)
      .set({ submittedAt: now })
      .where(and(eq(opportunityPartnerInvites.id, invite.id), eq(opportunityPartnerInvites.organizationId, organizationId)));
  }
  const summary = partnerAnswerSummary(questions, answers);
  if (submit) await notifyInviter({ organizationId, opportunityId, recipientUserId: invite.createdByUserId, partnerName: partner.name, summary });
  await recordAudit({
    organizationId,
    actor: { userId: null, email: invite.email },
    action: submit ? "opportunity.partner.answers.submit" : "opportunity.partner.answers.save",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: { partnerId: partner.id, ...summary, certifications: certificationLabels(certifications) },
  });
  return { ok: true, state: submit || invite.submittedAt ? "submitted" : "open" };
}

/**
 * BL-NAV-LIFECYCLE 3c-2 — the inviter's inbox gets one line when a
 * partner submits (a `notification` row only; no delivery row, so the
 * inbox-parity rule doesn't apply). The same partner submitting again
 * within an hour doesn't repeat it. Never fails the submit.
 */
async function notifyInviter(input: { organizationId: string; opportunityId: string; recipientUserId: string | null; partnerName: string; summary: PartnerAnswerSummary }) {
  if (!input.recipientUserId) return;
  const subject = `${input.partnerName} answered the capability questions`;
  try {
    const [dup] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.organizationId, input.organizationId), eq(notifications.recipientUserId, input.recipientUserId), eq(notifications.subject, subject), gt(notifications.createdAt, new Date(Date.now() - 3_600_000))))
      .limit(1);
    if (dup) return;
    await db.insert(notifications).values({
      organizationId: input.organizationId,
      recipientUserId: input.recipientUserId,
      kind: "partner_answered",
      subject,
      body: `${input.summary.answered} of ${input.summary.total} answered: ${input.summary.yes} yes, ${input.summary.partial} partial, ${input.summary.no} no. Compare the answers beside yours.`,
      linkPath: `/opportunities/${input.opportunityId}/partners/compare`,
    });
  } catch (err) {
    log.warn("[partner-invite]", "inviter notification failed", { opportunityId: input.opportunityId, error: err });
  }
}
