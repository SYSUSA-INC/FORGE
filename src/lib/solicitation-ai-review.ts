/**
 * BL-23 AI runners — solicitation review, capability matrix, question
 * generator. Each is a thin wrapper around the AI gateway with stub-
 * mode handling and zod validation, mirroring the pattern from
 * `solicitation-extract.ts` and `ebuy-extract.ts`.
 *
 * BL-STAB-9 — the review asks only for judgement; its requirements and
 * Sections L/M come from the parse (`review-basis.ts`).
 */
import { completeStructuredForTenant } from "@/lib/ai";
import {
  buildCapabilityMatrixPrompt,
  buildQuestionGeneratorPrompt,
  buildSolicitationReviewPrompt,
  capabilityMatrixSchema,
  questionSetSchema,
  solicitationReviewSchema,
  type CapabilityMatrixVerdict,
  type QuestionSetVerdict,
  type SolicitationReviewVerdict,
} from "@/lib/ai-prompts-bl23";
import type { SolicitationReviewResult } from "@/db/schema";
import { log } from "@/lib/log";

type Ok<T> = {
  ok: true;
  data: T;
  provider: string;
  model: string;
  stubbed: boolean;
};
type Err = { ok: false; error: string };

type ReviewRequirement = SolicitationReviewResult["requirements"][number];
type ReviewFactor = SolicitationReviewResult["evaluationFactors"][number];

// ────────────────────────────────────────────────────────────────────
// 1. Solicitation review
// ────────────────────────────────────────────────────────────────────

export async function aiRunSolicitationReview(input: {
  organizationId: string;
  title: string;
  fileName: string;
  rawText: string;
  /** What the parse already holds, given to the model as context. */
  basis?: { requirementCount: number; factors: string[] };
  /** BL-AIX Phase 1i-2 — pin a candidate model (eval runs); unset follows routing. */
  model?: string;
}): Promise<Ok<SolicitationReviewVerdict> | Err> {
  if (!input.rawText.trim()) {
    return {
      ok: false,
      error:
        "Solicitation has no extracted text yet. Wait for the upload pipeline to finish, or re-upload the file.",
    };
  }

  try {
    const prompt = buildSolicitationReviewPrompt(input);
    const ai = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "solicitation_review",
      model: input.model || undefined,
      schema: solicitationReviewSchema,
      toolName: "record_solicitation_review",
      system: prompt.system,
      messages: prompt.messages,
      // A summary, four short fields and two short lists: about 600 tokens.
      maxTokens: 2000,
      temperature: 0.1,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      return { ok: true, provider: ai.provider, model: ai.model, stubbed: true, data: stubReviewVerdict() };
    }

    if (!ai.data) {
      log.error("[aiRunSolicitationReview]", "parse", { error: ai.parseError, viaTool: ai.viaTool, stopReason: ai.stopReason });
      return { ok: false, error: ai.parseError ?? "AI response did not match the expected shape." };
    }

    return { ok: true, provider: ai.provider, model: ai.model, stubbed: false, data: ai.data };
  } catch (err) {
    log.error("[aiRunSolicitationReview]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Review failed.",
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// 2. Capability matrix
// ────────────────────────────────────────────────────────────────────

export async function aiRunCapabilityMatrix(input: {
  organizationId: string;
  solicitationTitle: string;
  agency: string;
  setAside: string;
  requirements: ReviewRequirement[];
  knowledgeEntries: {
    id: string;
    kind: string;
    title: string;
    body: string;
    tags: string[];
  }[];
}): Promise<Ok<CapabilityMatrixVerdict> | Err> {
  if (input.requirements.length === 0) {
    return {
      ok: false,
      error:
        "Review extracted no requirements yet. Re-run the solicitation review first.",
    };
  }

  try {
    const prompt = buildCapabilityMatrixPrompt(input);
    const ai = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "capability_matrix",
      schema: capabilityMatrixSchema,
      toolName: "record_capability_matrix",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 4000,
      temperature: 0.2,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      return {
        ok: true,
        provider: ai.provider,
        model: ai.model,
        stubbed: true,
        data: stubMatrixVerdict(input.requirements),
      };
    }

    if (!ai.data) {
      log.error("[aiRunCapabilityMatrix]", "parse", {
        error: ai.parseError,
        viaTool: ai.viaTool,
      });
      return {
        ok: false,
        error: ai.parseError ?? "AI response did not match the expected shape.",
      };
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: ai.data,
    };
  } catch (err) {
    log.error("[aiRunCapabilityMatrix]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Matrix generation failed.",
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// 3. Question generator
// ────────────────────────────────────────────────────────────────────

export async function aiRunQuestionGenerator(input: {
  organizationId: string;
  solicitationTitle: string;
  agency: string;
  reviewSummary: string;
  sectionL: string[];
  sectionM: string[];
  requirements: ReviewRequirement[];
  evaluationFactors: ReviewFactor[];
  flaggedQuestions: string[];
}): Promise<Ok<QuestionSetVerdict> | Err> {
  try {
    const prompt = buildQuestionGeneratorPrompt(input);
    const ai = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "question_generator",
      schema: questionSetSchema,
      toolName: "record_question_set",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 3000,
      temperature: 0.2,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      return {
        ok: true,
        provider: ai.provider,
        model: ai.model,
        stubbed: true,
        data: stubQuestionVerdict(),
      };
    }

    if (!ai.data) {
      log.error("[aiRunQuestionGenerator]", "parse", {
        error: ai.parseError,
        viaTool: ai.viaTool,
      });
      return {
        ok: false,
        error: ai.parseError ?? "AI response did not match the expected shape.",
      };
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: ai.data,
    };
  } catch (err) {
    log.error("[aiRunQuestionGenerator]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Question generation failed.",
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Stub-mode payloads — let the UI flow render with deterministic
// placeholder data so capture managers can demo / test the UI even
// without an Anthropic key configured.
// ────────────────────────────────────────────────────────────────────

function stubReviewVerdict(): SolicitationReviewVerdict {
  return {
    summary:
      "AI document review is in stub mode. Set ANTHROPIC_API_KEY on Vercel to enable a real review against your uploaded RFP. The requirements, Sections L and M and evaluation factors below come from the parse.",
    periodOfPerformance: "",
    placeOfPerformance: "",
    setAside: "",
    mandatoryCertifications: [],
    flaggedQuestions: [],
  };
}

function stubMatrixVerdict(
  requirements: ReviewRequirement[],
): CapabilityMatrixVerdict {
  return {
    cells: requirements.map((r) => ({
      requirementId: r.id,
      capabilityRef: "",
      status: "not_addressed",
      citation: "",
      narrative:
        "AI scoring is in stub mode. Set ANTHROPIC_API_KEY to score this requirement against the live knowledge corpus.",
    })),
    pwinRecommendationLow: 0,
    pwinRecommendationHigh: 0,
    pwinRationale:
      "Stub-mode placeholder. Real PWin recommendation requires the live AI provider.",
  };
}

function stubQuestionVerdict(): QuestionSetVerdict {
  return {
    questions: [
      {
        id: "q_stub_1",
        category: "submission_logistics",
        text: "Will Q&A submissions be made via the SAM.gov portal or directly to the contracting officer's email?",
        rationale:
          "Stub-mode placeholder. Real question generation requires the live AI provider.",
        sectionRef: "L.7",
      },
    ],
  };
}
