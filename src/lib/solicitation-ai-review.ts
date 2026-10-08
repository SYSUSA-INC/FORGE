/**
 * BL-23 AI runners — solicitation review, capability matrix, question
 * generator. Each is a thin wrapper around the AI gateway with stub-
 * mode handling and zod validation, mirroring the pattern from
 * `solicitation-extract.ts` and `ebuy-extract.ts`.
 *
 * BL-STAB-9 — every answer is sized to fit its output limit whatever the
 * size of the RFP: the review asks only for judgement (its requirements
 * and Sections L/M come from the parse), the matrix scores the
 * requirements a window at a time (a cut-off window is split and
 * re-read) and judges PWin in its own small answer, and the question
 * generator reads a bounded, prioritised list.
 */
import { completeStructuredForTenant } from "@/lib/ai";
import {
  buildCapabilityMatrixPrompt,
  buildCapabilityPwinPrompt,
  buildQuestionGeneratorPrompt,
  buildSolicitationReviewPrompt,
  capabilityMatrixSchema,
  capabilityPwinSchema,
  MATRIX_CELL_STATUSES,
  QUESTION_CATEGORIES,
  questionSetSchema,
  solicitationReviewSchema,
  type CapabilityMatrixVerdict,
  type MatrixCellStatus,
  type QuestionSetVerdict,
  type SolicitationReviewVerdict,
} from "@/lib/ai-prompts-bl23";
import type { SolicitationReviewResult } from "@/db/schema";
import { log } from "@/lib/log";
import { choiceOf } from "@/lib/zod-tolerant";

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

/** Requirements per matrix answer: 20 one-sentence cells fit well inside the output limit. */
export const MATRIX_WINDOW = 20;
/** Windows scored at once after the first (which warms the prompt cache). */
const MATRIX_CONCURRENCY = 4;
const MATRIX_WINDOW_MAX_TOKENS = 3000;

type MatrixCell = CapabilityMatrixVerdict["cells"][number];
type KnowledgeEntry = { id: string; kind: string; title: string; body: string; tags: string[] };

export type CapabilityMatrixRun = CapabilityMatrixVerdict & {
  /** Requirements this run could not score (a window that failed twice, or the time budget ran out). */
  unscored: string[];
};

async function inWindows<T>(items: T[], limit: number, run: (item: T) => Promise<void>, keepGoing: () => boolean): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && keepGoing()) {
      const item = items[next++]!;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Score the requirements against the company's knowledge, a window at a
 * time. `existing` cells are kept (only requirements without one are
 * scored), so a run that stopped can be finished by another. Windows
 * still waiting when `stopAt` passes are left unscored and reported.
 */
export async function aiRunCapabilityMatrix(input: {
  organizationId: string;
  solicitationTitle: string;
  agency: string;
  setAside: string;
  requirements: ReviewRequirement[];
  factors: ReviewFactor[];
  knowledgeEntries: KnowledgeEntry[];
  existing?: MatrixCell[];
  /** Epoch ms after which no new window is started. */
  stopAt: number;
}): Promise<Ok<CapabilityMatrixRun> | Err> {
  if (input.requirements.length === 0) {
    return { ok: false, error: "The review has no requirements to score. Re-run the review after the document is parsed." };
  }

  const known = new Set(input.requirements.map((r) => r.id));
  const cells = new Map<string, MatrixCell>();
  for (const c of input.existing ?? []) if (known.has(c.requirementId)) cells.set(c.requirementId, c);
  const todo = input.requirements.filter((r) => !cells.has(r.id));
  const windows: ReviewRequirement[][] = [];
  for (let i = 0; i < todo.length; i += MATRIX_WINDOW) windows.push(todo.slice(i, i + MATRIX_WINDOW));

  let provider = "";
  let model = "";
  let stubbed = false;
  let lastError = "";
  // A refused call (the tenant's AI quota) stops new windows; a window
  // that throws is counted as failed instead of abandoning the run while
  // the others carry on.
  let halted = false;
  const keepGoing = () => !halted && Date.now() < input.stopAt;

  const scoreWindow = async (reqs: ReviewRequirement[], depth: number): Promise<void> => {
    try {
      await scoreWindowOnce(reqs, depth);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === "QuotaExceededError") halted = true;
      log.warn("[aiRunCapabilityMatrix]", "window error", { size: reqs.length, depth, error: lastError });
    }
  };

  const scoreWindowOnce = async (reqs: ReviewRequirement[], depth: number): Promise<void> => {
    const prompt = buildCapabilityMatrixPrompt({
      solicitationTitle: input.solicitationTitle,
      agency: input.agency,
      setAside: input.setAside,
      requirements: reqs,
      knowledgeEntries: input.knowledgeEntries,
    });
    const ai = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "capability_matrix",
      variant: depth === 0 ? "cells" : "cells_split",
      schema: capabilityMatrixSchema,
      toolName: "record_capability_cells",
      toolDescription: "Record one capability matrix cell per requirement given.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: MATRIX_WINDOW_MAX_TOKENS,
      temperature: 0.2,
      cacheSystem: true,
    });
    provider = ai.provider;
    model = ai.model;
    if (ai.stubbed) {
      stubbed = true;
      for (const r of reqs) cells.set(r.id, stubCell(r.id));
      return;
    }
    if (!ai.data) {
      lastError = ai.parseError ?? "AI response did not match the expected shape.";
      // Too much for one answer, or unreadable: halve the window once.
      if (depth === 0 && reqs.length > 1) {
        const mid = Math.ceil(reqs.length / 2);
        await Promise.all([scoreWindow(reqs.slice(0, mid), 1), scoreWindow(reqs.slice(mid), 1)]);
        return;
      }
      log.warn("[aiRunCapabilityMatrix]", "window failed", { size: reqs.length, depth, error: lastError, stopReason: ai.stopReason });
      return;
    }
    const ids = new Set(reqs.map((r) => r.id));
    for (const c of ai.data.cells) {
      if (!ids.has(c.requirementId) || cells.has(c.requirementId)) continue;
      cells.set(c.requirementId, {
        requirementId: c.requirementId,
        capabilityRef: c.capabilityRef.startsWith("knowledge:") ? c.capabilityRef : "",
        status: choiceOf(MATRIX_CELL_STATUSES, c.status, "not_addressed"),
        citation: c.citation.slice(0, 240),
        narrative: c.narrative.slice(0, 400),
      });
    }
  };

  if (windows.length > 0) {
    // The first window writes the corpus into the prompt cache; the rest read it.
    await scoreWindow(windows[0]!, 0);
    await inWindows(windows.slice(1), MATRIX_CONCURRENCY, (w) => scoreWindow(w, 0), keepGoing);
  }

  const ordered = input.requirements.map((r) => cells.get(r.id)).filter((c): c is MatrixCell => Boolean(c));
  const unscored = input.requirements.filter((r) => !cells.has(r.id)).map((r) => r.id);
  if (ordered.length === 0) {
    return { ok: false, error: lastError || "No requirement could be scored. Try again in a few minutes." };
  }

  if (stubbed) {
    return {
      ok: true,
      provider,
      model,
      stubbed: true,
      data: { cells: ordered, unscored, pwinRecommendationLow: 0, pwinRecommendationHigh: 0, pwinRationale: "Stub-mode placeholder. A real PWin recommendation needs the live AI provider." },
    };
  }

  const pwin = await aiRunMatrixPwin({ ...input, cells: ordered });
  return {
    ok: true,
    provider: pwin.provider || provider,
    model: pwin.model || model,
    stubbed: false,
    data: { cells: ordered, unscored, ...pwin.verdict },
  };
}

/** The PWin recommendation over a scored matrix, in its own small answer. */
async function aiRunMatrixPwin(input: {
  organizationId: string;
  solicitationTitle: string;
  agency: string;
  setAside: string;
  requirements: ReviewRequirement[];
  factors: ReviewFactor[];
  cells: MatrixCell[];
}): Promise<{ provider: string; model: string; verdict: Pick<CapabilityMatrixVerdict, "pwinRecommendationLow" | "pwinRecommendationHigh" | "pwinRationale"> }> {
  const counts = Object.fromEntries(MATRIX_CELL_STATUSES.map((s) => [s, 0])) as Record<MatrixCellStatus, number>;
  for (const c of input.cells) counts[c.status] += 1;
  const byId = new Map(input.requirements.map((r) => [r.id, r]));
  const line = (c: MatrixCell) => {
    const r = byId.get(c.requirementId);
    return `- [${r?.kind ?? "shall"}] ${r?.text.slice(0, 160) ?? c.requirementId} — ${c.narrative.slice(0, 160)}`;
  };
  const rank = (c: MatrixCell) => (byId.get(c.requirementId)?.kind === "shall" ? 0 : 1);
  const strong = input.cells.filter((c) => c.status === "strong").sort((a, b) => rank(a) - rank(b)).slice(0, 15).map(line);
  const gaps = input.cells.filter((c) => c.status === "gap" || c.status === "not_addressed").sort((a, b) => rank(a) - rank(b)).slice(0, 15).map(line);
  const none = { pwinRecommendationLow: 0, pwinRecommendationHigh: 0, pwinRationale: "" };
  try {
    const prompt = buildCapabilityPwinPrompt({ ...input, counts, strong, gaps });
    const ai = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "capability_matrix",
      variant: "pwin",
      schema: capabilityPwinSchema,
      toolName: "record_pwin_recommendation",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 800,
      temperature: 0.2,
    });
    if (!ai.data) {
      log.warn("[aiRunCapabilityMatrix]", "pwin failed", { error: ai.parseError });
      return { provider: ai.provider, model: ai.model, verdict: { ...none, pwinRationale: "The PWin recommendation could not be produced this time; re-build the matrix to try again." } };
    }
    return { provider: ai.provider, model: ai.model, verdict: ai.data };
  } catch (err) {
    log.warn("[aiRunCapabilityMatrix]", "pwin error", { error: err });
    return { provider: "", model: "", verdict: none };
  }
}

// ────────────────────────────────────────────────────────────────────
// 3. Question generator
// ────────────────────────────────────────────────────────────────────

/** At most 60 requirements are shown: mandatory ones first, in document order. */
export function questionRequirements(requirements: ReviewRequirement[]): ReviewRequirement[] {
  const order = { shall: 0, should: 1, may: 2 } as const;
  return requirements
    .map((r, i) => ({ r, i }))
    .sort((a, b) => order[a.r.kind] - order[b.r.kind] || a.i - b.i)
    .slice(0, 60)
    .map((x) => x.r);
}

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
    const prompt = buildQuestionGeneratorPrompt({ ...input, requirements: questionRequirements(input.requirements) });
    const ai = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "question_generator",
      schema: questionSetSchema,
      toolName: "record_question_set",
      system: prompt.system,
      messages: prompt.messages,
      // Up to 25 questions of two sentences plus a one-line rationale.
      maxTokens: 6000,
      temperature: 0.2,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      return { ok: true, provider: ai.provider, model: ai.model, stubbed: true, data: stubQuestionVerdict() };
    }

    if (!ai.data) {
      log.error("[aiRunQuestionGenerator]", "parse", { error: ai.parseError, viaTool: ai.viaTool, stopReason: ai.stopReason });
      return { ok: false, error: ai.parseError ?? "AI response did not match the expected shape." };
    }

    const used = new Set<string>();
    const perCategory = new Map<string, number>();
    const questions = ai.data.questions.map((q) => {
      const category = choiceOf(QUESTION_CATEGORIES, q.category, "scope_ambiguity");
      const n = (perCategory.get(category) ?? 0) + 1;
      perCategory.set(category, n);
      let id = q.id.trim().slice(0, 40);
      if (!id || used.has(id)) id = `q_${category}_${n}`;
      used.add(id);
      return { id, category, text: q.text.trim(), rationale: q.rationale.trim(), sectionRef: q.sectionRef.trim().slice(0, 64) };
    });
    if (questions.length === 0) return { ok: false, error: "The AI returned no usable questions. Try again." };
    return { ok: true, provider: ai.provider, model: ai.model, stubbed: false, data: { questions } };
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

function stubCell(requirementId: string): MatrixCell {
  return {
    requirementId,
    capabilityRef: "",
    status: "not_addressed",
    citation: "",
    narrative: "AI scoring is in stub mode. Set ANTHROPIC_API_KEY to score this requirement against the live knowledge corpus.",
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
