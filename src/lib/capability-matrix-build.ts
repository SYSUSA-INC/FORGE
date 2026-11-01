import "server-only";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, opportunities, opportunityCapabilityMatrices, organizations, solicitationCapabilityMatrices, solicitationReviews, solicitations } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { recordAudit } from "@/lib/audit-log";
import { buildCapabilityQuestionsPrompt } from "@/lib/capability-matrix-prompt";
import { buildQuestionSet, carryOverAnswers, draftedQuestionSchema, parseVersionOf } from "@/lib/capability-matrix-types";
import { acceptAiSuggestions, aiSuggestionSchema, CAPABILITY_SUGGESTION_KNOWLEDGE_LIMIT, mergeSuggestions, suggestFromMatrixCells, suggestFromPriorAnswers, type AllowedSource, type MatrixRequirement } from "@/lib/capability-suggestions";
import { buildCapabilitySuggestionsPrompt } from "@/lib/capability-suggestions-prompt";
import { modelCapabilityRef } from "@/lib/company-model";
import { getApprovedCompanyModel } from "@/lib/company-model-read";
import { log } from "@/lib/log";
import { selectKnowledgeForMatrix } from "@/lib/matrix-knowledge";
import { enforceRateLimit } from "@/lib/rate-limit";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

/**
 * BL-CAP-MATRIX phases A and C, moved out of the actions for
 * BL-NEXT-ACTION 5c so the nightly prepare step can build the
 * questionnaire and suggest its answers without a session. Callers own
 * auth and revalidation; `actor.userId` is null when FORGE ran it.
 */
type Actor = { userId: string | null; email?: string | null };

export async function loadOwnedOpportunity(opportunityId: string, organizationId: string) {
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

export async function loadCapabilityMatrix(opportunityId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(opportunityCapabilityMatrices)
    .where(and(eq(opportunityCapabilityMatrices.opportunityId, opportunityId), eq(opportunityCapabilityMatrices.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

const loadOwned = loadOwnedOpportunity;
const loadMatrix = loadCapabilityMatrix;

export async function buildCapabilityQuestions(input: {
  organizationId: string;
  opportunityId: string;
  actor: Actor;
}): Promise<{ ok: true; questions: number; carried: number } | { ok: false; error: string }> {
  const { organizationId, actor } = input;
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
    log.warn("[buildCapabilityQuestions]", "structured parse failed", {
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
      builtByUserId: actor.userId,
      builtAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opportunityCapabilityMatrices.opportunityId,
      set: { parseVersion, questions, answers, suggestions: {}, builtByUserId: actor.userId, builtAt: now, updatedAt: now },
    });

  await recordAudit({
    organizationId,
    actor,
    action: "opportunity.capability_questions.build",
    resourceType: "opportunity",
    resourceId: opp.id,
    metadata: {
      questions: questions.length,
      carried: Object.keys(answers).length,
      requirements: reqs.requirements.length,
      rebuild: !!previous,
      actorKind: actor.userId ? "user" : "forge",
    },
  });
  return { ok: true, questions: questions.length, carried: Object.keys(answers).length };
}

export async function suggestCapabilityAnswers(input: {
  organizationId: string;
  opportunityId: string;
  actor: Actor;
}): Promise<
  | { ok: true; suggested: number; fromMatrix: number; fromPrior: number; fromAi: number; aiSkipped: string | null }
  | { ok: false; error: string }
> {
  const { organizationId, actor } = input;
  const opp = await loadOwned(input.opportunityId, organizationId);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const row = await loadMatrix(opp.id, organizationId);
  if (!row) return { ok: false, error: "Build the questionnaire first." };
  const open = row.questions.filter((q) => !row.answers[q.id]);
  if (open.length === 0) return { ok: false, error: "Every question is answered; nothing to suggest." };

  const limit = await enforceRateLimit({
    key: `capability-suggestions:${organizationId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return { ok: false, error: `Suggestion limit reached (10/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.` };
  }
  const now = new Date().toISOString();

  // 1. The solicitation's AI-scored matrix (BL-STAB-9b), one cell per
  //    review requirement; the review's sectionRef is the parsed ref the
  //    questions cite when the review was built on the parse.
  const scored = await db
    .select({ cells: solicitationCapabilityMatrices.cells, result: solicitationReviews.result })
    .from(solicitationCapabilityMatrices)
    .innerJoin(solicitations, eq(solicitations.id, solicitationCapabilityMatrices.solicitationId))
    .innerJoin(solicitationReviews, eq(solicitationReviews.id, solicitationCapabilityMatrices.solicitationReviewId))
    .where(
      and(
        eq(solicitationCapabilityMatrices.organizationId, organizationId),
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.opportunityId, opp.id),
      ),
    );
  const cells = scored.flatMap((s) => s.cells);
  const requirements: MatrixRequirement[] = scored.flatMap((s) =>
    (s.result.requirements ?? []).map((r) => ({ id: r.id, sectionRef: r.sectionRef })),
  );
  const citedIds = cells
    .map((c) => (c.capabilityRef.startsWith("knowledge:") ? c.capabilityRef.slice("knowledge:".length) : ""))
    .filter(Boolean);
  const knowledgeTitles = new Map<string, string>();
  if (citedIds.length > 0) {
    const titled = await db
      .select({ id: knowledgeEntries.id, title: knowledgeEntries.title })
      .from(knowledgeEntries)
      .where(and(eq(knowledgeEntries.organizationId, organizationId), inArray(knowledgeEntries.id, citedIds)));
    for (const t of titled) knowledgeTitles.set(t.id, t.title);
  }
  const fromMatrix = suggestFromMatrixCells({ questions: open, requirements, cells, knowledgeTitles, now });

  // 2. Standing answers given on this organisation's earlier questionnaires.
  const priorRows = await db
    .select({ opportunityId: opportunityCapabilityMatrices.opportunityId, title: opportunities.title, answers: opportunityCapabilityMatrices.answers })
    .from(opportunityCapabilityMatrices)
    .innerJoin(opportunities, eq(opportunities.id, opportunityCapabilityMatrices.opportunityId))
    .where(
      and(
        eq(opportunityCapabilityMatrices.organizationId, organizationId),
        eq(opportunities.organizationId, organizationId),
        ne(opportunityCapabilityMatrices.opportunityId, opp.id),
      ),
    )
    .orderBy(desc(opportunityCapabilityMatrices.updatedAt))
    .limit(25);
  const fromPrior = suggestFromPriorAnswers({ questions: open, prior: priorRows, now });

  // 3. One AI call over past performance and the knowledge base for the rest.
  const left = open.filter((q) => !fromMatrix[q.id] && !fromPrior[q.id]);
  let fromAi: Record<string, (typeof fromMatrix)[string]> = {};
  let aiSkipped: string | null = null;
  if (left.length > 0) {
    const [org] = await db
      .select({ pastPerformance: organizations.pastPerformance })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const pastPerformance = org?.pastPerformance ?? [];
    const knowledge = await selectKnowledgeForMatrix({
      organizationId,
      query: [`Opportunity: ${opp.title}`, ...left.map((q) => q.text)].join("\n"),
      limit: CAPABILITY_SUGGESTION_KNOWLEDGE_LIMIT,
    });
    // BL-COMPANY-MODEL 1c — the approved model's capabilities are evidence too.
    const model = await getApprovedCompanyModel(organizationId);
    const companyCapabilities = (model?.body.capabilities ?? []).map((c) => ({ ref: modelCapabilityRef(c.name), name: c.name, description: c.description, strength: c.strength }));
    if (pastPerformance.length === 0 && knowledge.entries.length === 0 && companyCapabilities.length === 0) {
      aiSkipped = "no past performance, knowledge entries or approved company model on file";
    } else {
      try {
        await ensureFeature(organizationId, "aiAutoDraft");
        await enforceQuota(organizationId, "aiRequestsPerMonth");
      } catch (err) {
        if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
        throw err;
      }
      const prompt = buildCapabilitySuggestionsPrompt({
        opportunity: opp,
        questions: left,
        pastPerformance,
        knowledgeEntries: knowledge.entries,
        companyCapabilities,
      });
      const res = await completeStructuredForTenant({
        organizationId,
        feature: "capability_suggestions",
        schema: aiSuggestionSchema,
        toolName: "record_capability_suggestions",
        toolDescription: "Record a suggested answer, with its evidence and sources, for each question the evidence supports.",
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: 3000,
        temperature: 0.2,
        cacheSystem: true,
      });
      if (res.stubbed) {
        await refundQuota(organizationId, "aiRequestsPerMonth");
        aiSkipped = "AI provider is in stub mode";
      } else if (!res.data) {
        await refundQuota(organizationId, "aiRequestsPerMonth");
        log.warn("[suggestCapabilityAnswers]", "structured parse failed", { parseError: res.parseError, viaTool: res.viaTool });
        aiSkipped = "AI returned an unexpected format";
      } else {
        const allowed = new Map<string, AllowedSource>();
        for (const p of pastPerformance) allowed.set(`pp:${p.id}`, { kind: "past_performance", label: `${p.customer} — ${p.contract}`.trim() });
        for (const e of knowledge.entries) allowed.set(`knowledge:${e.id}`, { kind: "knowledge", label: e.title });
        for (const c of companyCapabilities) allowed.set(`model:${c.ref}`, { kind: "model", label: `Company model: ${c.name}` });
        fromAi = acceptAiSuggestions({ parsed: res.data, questions: left, allowed, now });
      }
    }
  }

  const suggestions = mergeSuggestions(row.questions, row.answers, [fromMatrix, fromPrior, fromAi]);
  await db
    .update(opportunityCapabilityMatrices)
    .set({ suggestions, updatedAt: new Date() })
    .where(and(eq(opportunityCapabilityMatrices.id, row.id), eq(opportunityCapabilityMatrices.organizationId, organizationId)));

  const counts = {
    suggested: Object.keys(suggestions).length,
    fromMatrix: Object.keys(fromMatrix).length,
    fromPrior: Object.keys(fromPrior).filter((id) => !fromMatrix[id]).length,
    fromAi: Object.keys(fromAi).length,
  };
  await recordAudit({
    organizationId,
    actor,
    action: "opportunity.capability_questions.suggest",
    resourceType: "opportunity",
    resourceId: opp.id,
    metadata: { ...counts, open: open.length, aiSkipped, actorKind: actor.userId ? "user" : "forge" },
  });
  return { ok: true, ...counts, aiSkipped };
}
