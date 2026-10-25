"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { companies, opportunities, opportunityCapabilityMatrices } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { buildCapabilityQuestionsPrompt } from "@/lib/capability-matrix-prompt";
import {
  buildQuestionSet,
  CAPABILITY_ANSWER_VALUES,
  CAPABILITY_EVIDENCE_MAX,
  CAPABILITY_QUESTION_TEXT_MAX,
  carryOverAnswers,
  draftedQuestionSchema,
  parseVersionOf,
  type CapabilityAnswer,
  type CapabilityAnswerValue,
} from "@/lib/capability-matrix-types";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";

/**
 * BL-CAP-MATRIX phase A — the capability questionnaire. FORGE drafts the
 * questions from the opportunity's parsed solicitation(s); a person reviews,
 * edits and answers them. Nothing here scores or changes PWin (phase B).
 */

type Result = { ok: true } | { ok: false; error: string };

async function loadOwned(opportunityId: string, organizationId: string) {
  const [opp] = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      placeOfPerformance: opportunities.placeOfPerformance,
      incumbent: opportunities.incumbent,
      description: opportunities.description,
    })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  return opp ?? null;
}

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

export async function buildCapabilityQuestionsAction(input: {
  opportunityId: string;
}): Promise<{ ok: true; questions: number; carried: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const opp = await loadOwned(input.opportunityId, organizationId);
  if (!opp) return { ok: false, error: "Opportunity not found." };

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const limit = await enforceRateLimit({
    key: `capability-questions:${organizationId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Question-drafting limit reached (10/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  const reqs = await loadOpportunityRequirements({ organizationId, opportunityId: opp.id });
  if (reqs.requirements.length === 0) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: "Parse a solicitation on this opportunity first; the questions come from its requirements." };
  }

  const prompt = buildCapabilityQuestionsPrompt({
    opportunity: opp,
    requirements: reqs.requirements,
    sectionLSummary: reqs.sectionLSummary,
    sectionMSummary: reqs.sectionMSummary,
  });
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "capability_questions",
    schema: draftedQuestionSchema,
    toolName: "record_capability_questions",
    toolDescription: "Record the drafted capability questions, each with the requirement references it covers.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 2500,
    temperature: 0.2,
    cacheSystem: true,
  });
  if (res.stubbed) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: "AI provider is in stub mode — configure a provider to draft questions." };
  }
  if (!res.data) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.warn("[buildCapabilityQuestionsAction]", "structured parse failed", {
      parseError: res.parseError,
      viaTool: res.viaTool,
    });
    return { ok: false, error: "AI returned an unexpected format. Try again." };
  }

  const knownRefs = new Set(reqs.requirements.map((r) => r.ref));
  const questions = buildQuestionSet(res.data.questions, knownRefs);
  const parseVersion = parseVersionOf(reqs);
  const previous = await loadMatrix(opp.id, organizationId);
  const answers = previous ? carryOverAnswers(previous.questions, previous.answers, questions) : {};
  const now = new Date();

  await db
    .insert(opportunityCapabilityMatrices)
    .values({
      organizationId,
      opportunityId: opp.id,
      parseVersion,
      questions,
      answers,
      builtByUserId: actor.id,
      builtAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opportunityCapabilityMatrices.opportunityId,
      set: { parseVersion, questions, answers, builtByUserId: actor.id, builtAt: now, updatedAt: now },
    });

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.capability_questions.build",
    resourceType: "opportunity",
    resourceId: opp.id,
    metadata: {
      questions: questions.length,
      carried: Object.keys(answers).length,
      requirements: reqs.requirements.length,
      rebuild: !!previous,
    },
  });
  revalidatePath(evaluationPath(opp.id));
  return { ok: true, questions: questions.length, carried: Object.keys(answers).length };
}

export async function answerCapabilityQuestionAction(input: {
  opportunityId: string;
  questionId: string;
  value: CapabilityAnswerValue;
  evidence: string;
  partnerCompanyId: string | null;
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
    updatedAt: new Date().toISOString(),
    updatedByUserId: actor.id,
  };
  const answers = { ...row.answers, [input.questionId]: answer };
  await db
    .update(opportunityCapabilityMatrices)
    .set({ answers, updatedAt: new Date() })
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
    metadata: { questionId: input.questionId, value: input.value, partnerCompanyId },
  });
  revalidatePath(evaluationPath(input.opportunityId));
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
  revalidatePath(evaluationPath(input.opportunityId));
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
  await db
    .update(opportunityCapabilityMatrices)
    .set({ questions, answers, updatedAt: new Date() })
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
  revalidatePath(evaluationPath(input.opportunityId));
  return { ok: true };
}
