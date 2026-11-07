"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { companies, opportunityCapabilityMatrices } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { buildCapabilityQuestions, suggestCapabilityAnswers } from "@/lib/capability-matrix-build";
import {
  CAPABILITY_ANSWER_VALUES,
  CAPABILITY_EVIDENCE_MAX,
  CAPABILITY_QUESTION_TEXT_MAX,
  clampPartialPercent,
  type CapabilityAnswer,
  type CapabilityAnswerValue,
} from "@/lib/capability-matrix-types";

/**
 * BL-CAP-MATRIX phase A — the capability questionnaire. FORGE drafts the
 * questions from the opportunity's parsed solicitation(s); a person reviews,
 * edits and answers them. Phase C adds suggested answers: FORGE pre-fills
 * from the solicitation's scored matrix, earlier questionnaires, past
 * performance and the knowledge base; nothing counts until a person
 * confirms it (coverage and PWin read `answers` only).
 */

type Result = { ok: true } | { ok: false; error: string };

async function loadMatrix(opportunityId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(opportunityCapabilityMatrices)
    .where(
      and(
        eq(opportunityCapabilityMatrices.opportunityId, opportunityId),
        eq(opportunityCapabilityMatrices.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function evaluationPath(opportunityId: string): string {
  return `/opportunities/${opportunityId}/evaluation`;
}

/** BL-NAV-LIFECYCLE 2b — the questionnaire's own page, the Evaluation tab's summary and the Evaluate list. */
function revalidateMatrix(opportunityId: string): void {
  revalidatePath(`/opportunities/${opportunityId}/capability`);
  revalidatePath(evaluationPath(opportunityId));
  revalidatePath("/pipeline/evaluate");
}

export async function buildCapabilityQuestionsAction(input: {
  opportunityId: string;
}): Promise<{ ok: true; questions: number; carried: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await buildCapabilityQuestions({ organizationId, opportunityId: input.opportunityId, actor: { userId: actor.id, email: actor.email } });
  if (res.ok) revalidateMatrix(input.opportunityId);
  return res;
}

export async function answerCapabilityQuestionAction(input: {
  opportunityId: string;
  questionId: string;
  value: CapabilityAnswerValue;
  evidence: string;
  partnerCompanyId: string | null;
  /** BL-NAV-LIFECYCLE 2b — a Partial's percentage (5..95). */
  percent?: number | null;
  /** True when the person confirmed FORGE's suggestion as given. */
  fromSuggestion?: boolean;
}): Promise<Result> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!CAPABILITY_ANSWER_VALUES.includes(input.value)) return { ok: false, error: "Pick an answer." };
  const evidence = input.evidence.trim().slice(0, CAPABILITY_EVIDENCE_MAX);

  const row = await loadMatrix(input.opportunityId, organizationId);
  if (!row) return { ok: false, error: "Build the questionnaire first." };
  if (!row.questions.some((q) => q.id === input.questionId)) {
    return { ok: false, error: "That question is no longer in the questionnaire." };
  }

  let partnerCompanyId: string | null = null;
  if (input.value === "gap_partner" && input.partnerCompanyId) {
    const [partner] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, input.partnerCompanyId), eq(companies.organizationId, organizationId)))
      .limit(1);
    if (!partner) return { ok: false, error: "Partner company not found." };
    partnerCompanyId = partner.id;
  }

  const answer: CapabilityAnswer = {
    value: input.value,
    evidence,
    partnerCompanyId,
    percent: input.value === "partial" ? clampPartialPercent(input.percent) : null,
    updatedAt: new Date().toISOString(),
    updatedByUserId: actor.id,
  };
  const answers = { ...row.answers, [input.questionId]: answer };
  // The person's answer replaces the suggestion, confirmed or not.
  const suggestions = { ...row.suggestions };
  delete suggestions[input.questionId];
  await db
    .update(opportunityCapabilityMatrices)
    .set({ answers, suggestions, updatedAt: new Date() })
    .where(
      and(
        eq(opportunityCapabilityMatrices.id, row.id),
        eq(opportunityCapabilityMatrices.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.capability_questions.answer",
    resourceType: "opportunity",
    resourceId: input.opportunityId,
    metadata: { questionId: input.questionId, value: input.value, percent: answer.percent, partnerCompanyId, fromSuggestion: !!input.fromSuggestion },
  });
  revalidateMatrix(input.opportunityId);
  return { ok: true };
}

export async function updateCapabilityQuestionAction(input: {
  opportunityId: string;
  questionId: string;
  text: string;
}): Promise<Result> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const text = input.text.trim().slice(0, CAPABILITY_QUESTION_TEXT_MAX);
  if (text.length < 8) return { ok: false, error: "Write the question out." };

  const row = await loadMatrix(input.opportunityId, organizationId);
  if (!row) return { ok: false, error: "Build the questionnaire first." };
  if (!row.questions.some((q) => q.id === input.questionId)) return { ok: false, error: "Question not found." };

  const questions = row.questions.map((q) => (q.id === input.questionId ? { ...q, text } : q));
  await db
    .update(opportunityCapabilityMatrices)
    .set({ questions, updatedAt: new Date() })
    .where(
      and(
        eq(opportunityCapabilityMatrices.id, row.id),
        eq(opportunityCapabilityMatrices.organizationId, organizationId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.capability_questions.edit",
    resourceType: "opportunity",
    resourceId: input.opportunityId,
    metadata: { questionId: input.questionId },
  });
  revalidateMatrix(input.opportunityId);
  return { ok: true };
}

export async function removeCapabilityQuestionAction(input: {
  opportunityId: string;
  questionId: string;
}): Promise<Result> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const row = await loadMatrix(input.opportunityId, organizationId);
  if (!row) return { ok: false, error: "Build the questionnaire first." };
  if (!row.questions.some((q) => q.id === input.questionId)) return { ok: false, error: "Question not found." };

  const questions = row.questions.filter((q) => q.id !== input.questionId);
  const answers = { ...row.answers };
  delete answers[input.questionId];
  const suggestions = { ...row.suggestions };
  delete suggestions[input.questionId];
  await db
    .update(opportunityCapabilityMatrices)
    .set({ questions, answers, suggestions, updatedAt: new Date() })
    .where(
      and(
        eq(opportunityCapabilityMatrices.id, row.id),
        eq(opportunityCapabilityMatrices.organizationId, organizationId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.capability_questions.remove",
    resourceType: "opportunity",
    resourceId: input.opportunityId,
    metadata: { questionId: input.questionId },
  });
  revalidateMatrix(input.opportunityId);
  return { ok: true };
}

/**
 * Phase C — FORGE suggests answers to the unanswered questions. The
 * solicitation's scored matrix and the carry-over standing answers come
 * first (no AI); one AI call reads past performance and the knowledge
 * base for what those left open. Suggestions replace the earlier set and
 * never touch `answers`.
 */
export async function suggestCapabilityAnswersAction(input: {
  opportunityId: string;
}): Promise<
  | { ok: true; suggested: number; fromMatrix: number; fromPrior: number; fromAi: number; aiSkipped: string | null }
  | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await suggestCapabilityAnswers({ organizationId, opportunityId: input.opportunityId, actor: { userId: actor.id, email: actor.email } });
  if (res.ok) revalidateMatrix(input.opportunityId);
  return res;
}

export async function dismissCapabilitySuggestionAction(input: {
  opportunityId: string;
  questionId: string;
}): Promise<Result> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const row = await loadMatrix(input.opportunityId, organizationId);
  if (!row) return { ok: false, error: "Build the questionnaire first." };
  if (!row.suggestions[input.questionId]) return { ok: true };

  const suggestions = { ...row.suggestions };
  delete suggestions[input.questionId];
  await db
    .update(opportunityCapabilityMatrices)
    .set({ suggestions, updatedAt: new Date() })
    .where(and(eq(opportunityCapabilityMatrices.id, row.id), eq(opportunityCapabilityMatrices.organizationId, organizationId)));
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.capability_questions.dismiss",
    resourceType: "opportunity",
    resourceId: input.opportunityId,
    metadata: { questionId: input.questionId },
  });
  revalidateMatrix(input.opportunityId);
  return { ok: true };
}
