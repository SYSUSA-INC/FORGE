/**
 * BL-23 AI runners — solicitation review, capability matrix, question
 * generator. Each is a thin wrapper around the AI gateway with stub-
 * mode handling and zod validation, mirroring the pattern from
 * `solicitation-extract.ts` and `ebuy-extract.ts`.
 */
import { complete } from "@/lib/ai";
import { parseAiJson } from "@/lib/ai-prompts";
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
import { log } from "@/lib/log";

type Ok<T> = {
  ok: true;
  data: T;
  provider: string;
  model: string;
  stubbed: boolean;
};
type Err = { ok: false; error: string };

// ────────────────────────────────────────────────────────────────────
// 1. Solicitation review
// ────────────────────────────────────────────────────────────────────

export async function aiRunSolicitationReview(input: {
  title: string;
  fileName: string;
  rawText: string;
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
    const ai = await complete({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 4000,
      temperature: 0.1,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      return {
        ok: true,
        provider: ai.provider,
        model: ai.model,
        stubbed: true,
        data: stubReviewVerdict(input.title),
      };
    }

    const parseResult = parseAiJson(ai.text, solicitationReviewSchema);
    if (!parseResult.ok) {
      log.error("[aiRunSolicitationReview]", "parse", {
        error: parseResult.error,
      });
      return { ok: false, error: parseResult.error };
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: parseResult.data,
    };
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
  solicitationTitle: string;
  agency: string;
  setAside: string;
  requirements: SolicitationReviewVerdict["requirements"];
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
    const ai = await complete({
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

    const parseResult = parseAiJson(ai.text, capabilityMatrixSchema);
    if (!parseResult.ok) {
      log.error("[aiRunCapabilityMatrix]", "parse", {
        error: parseResult.error,
      });
      return { ok: false, error: parseResult.error };
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: parseResult.data,
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
  solicitationTitle: string;
  agency: string;
  reviewSummary: string;
  sectionL: string[];
  sectionM: string[];
  requirements: SolicitationReviewVerdict["requirements"];
  evaluationFactors: SolicitationReviewVerdict["evaluationFactors"];
  flaggedQuestions: string[];
}): Promise<Ok<QuestionSetVerdict> | Err> {
  try {
    const prompt = buildQuestionGeneratorPrompt(input);
    const ai = await complete({
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

    const parseResult = parseAiJson(ai.text, questionSetSchema);
    if (!parseResult.ok) {
      log.error("[aiRunQuestionGenerator]", "parse", {
        error: parseResult.error,
      });
      return { ok: false, error: parseResult.error };
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: parseResult.data,
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

function stubReviewVerdict(title: string): SolicitationReviewVerdict {
  return {
    summary:
      "AI document review is in stub mode. Set ANTHROPIC_API_KEY on Vercel to enable a real review against your uploaded RFP. The shape below is illustrative.",
    sectionL: [
      "Submission limited to 30 pages, 11pt Times New Roman.",
      "Volumes I (Technical), II (Management), III (Past Performance), IV (Pricing).",
      "Q&A deadline 7 calendar days before due date.",
    ],
    sectionM: [
      "Factor 1: Technical Approach (40%).",
      "Factor 2: Management Approach (25%).",
      "Factor 3: Past Performance (20%).",
      "Factor 4: Price (15%).",
    ],
    requirements: [
      {
        id: "req_stub_1",
        kind: "shall",
        text: "Provide a written technical approach addressing all PWS tasks.",
        sectionRef: "L.5.2.1",
        capabilityArea: "Technical Approach",
      },
      {
        id: "req_stub_2",
        kind: "shall",
        text: "Demonstrate two relevant past performance citations within the last 5 years.",
        sectionRef: "L.5.2.3",
        capabilityArea: "Past Performance",
      },
    ],
    capabilityAreas: ["Technical Approach", "Past Performance"],
    evaluationFactors: [
      { name: "Technical Approach", weight: "40%", notes: "Highest-weighted factor." },
      { name: "Management Approach", weight: "25%", notes: "" },
      { name: "Past Performance", weight: "20%", notes: "" },
      { name: "Price", weight: "15%", notes: "" },
    ],
    periodOfPerformance: "Base + 4 option years",
    placeOfPerformance: "Contractor site with quarterly on-site reviews",
    setAside: "Total Small Business",
    mandatoryCertifications: ["FedRAMP Moderate"],
    flaggedQuestions: [
      "Are subcontractor past performance citations evaluated equally to prime?",
    ],
  };
}

function stubMatrixVerdict(
  requirements: SolicitationReviewVerdict["requirements"],
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
