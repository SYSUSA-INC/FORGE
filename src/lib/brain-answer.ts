/**
 * BL-AIP-7d — "Ask the Brain" from the ⌘K palette.
 *
 * A question typed into the palette is answered from the organization's
 * own Brain and nothing else: `searchBrain` (hybrid vector + full-text,
 * outcome-boosted) finds the six best sources, the model writes a short
 * answer that cites them by number, and the palette shows the answer
 * with the cited sources as links into the knowledge base.
 *
 * Gated like every other completion (`aiAutoDraft` flag, monthly request
 * quota, refunded when the model returns nothing usable). In stub mode,
 * or when the model's output fails validation, the top source's excerpt
 * stands in for an answer so the palette still leads somewhere.
 * Audited as `brain.answer`. Server-only; callers own auth.
 */
import "server-only";

import { completeStructuredForTenant } from "@/lib/ai";
import {
  BRAIN_ANSWER_PROMPT_VERSION,
  brainAnswerSchema,
  buildBrainAnswerPrompt,
  type BrainAnswerSourceInput,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { searchBrain, type BrainHit } from "@/lib/brain-retrieval";
import { clampConfidence } from "@/lib/brief-logic";
import { log } from "@/lib/log";
import {
  PALETTE_MAX_QUESTION,
  PALETTE_MIN_QUESTION,
  type BrainAnswerResult,
  type BrainAnswerSource,
} from "@/lib/palette";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";

/** Sources sent to the model per question. */
const BRAIN_ANSWER_SOURCES = 6;
/** Characters of each source the model sees. */
const EXCERPT_CHARS = 700;
/** Characters of each source the palette shows. */
const PREVIEW_CHARS = 220;

export type { BrainAnswerResult, BrainAnswerSource, BrainAnswerView } from "@/lib/palette";

function squash(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function hrefFor(hit: BrainHit): string {
  return hit.source === "entry" ? `/knowledge-base/${hit.id}` : `/knowledge-base/import/${hit.artifactId ?? hit.id}`;
}

function toSources(hits: BrainHit[]): { model: BrainAnswerSourceInput[]; view: BrainAnswerSource[] } {
  const model: BrainAnswerSourceInput[] = [];
  const view: BrainAnswerSource[] = [];
  hits.forEach((hit, i) => {
    const n = i + 1;
    const kind = hit.source === "entry" ? (hit.entryKind ?? "entry") : (hit.artifactKind ?? "document");
    const outcomeLabel = hit.outcomeLabel ?? "none";
    model.push({ n, title: hit.title, source: hit.source, kind, outcomeLabel, excerpt: squash(hit.content, EXCERPT_CHARS) });
    view.push({
      n,
      title: hit.title,
      href: hrefFor(hit),
      source: hit.source,
      kind,
      outcomeLabel,
      preview: squash(hit.content, PREVIEW_CHARS),
      cited: false,
    });
  });
  return { model, view };
}

/** The fallback when there is no model: the best source, quoted. */
function extractiveAnswer(hits: BrainHit[]): string {
  const top = hits[0]!;
  return `From "${top.title}": ${squash(top.content, 360)} [1]`;
}

export async function answerFromBrain(input: {
  organizationId: string;
  question: string;
  actor: { userId: string | null; email?: string | null };
}): Promise<BrainAnswerResult> {
  const { organizationId } = input;
  const question = input.question.replace(/\s+/g, " ").trim();
  if (question.length < PALETTE_MIN_QUESTION) return { ok: false, error: "Ask a longer question." };
  if (question.length > PALETTE_MAX_QUESTION) return { ok: false, error: "Ask a shorter question." };

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const refund = () => refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);

  const found = await searchBrain({ organizationId, query: question, take: BRAIN_ANSWER_SOURCES });
  if (!found.ok) {
    await refund();
    return { ok: false, error: found.error };
  }
  if (found.hits.length === 0) {
    await refund();
    return {
      ok: true,
      view: {
        question,
        answer:
          "The Brain has nothing on that yet. Add a knowledge entry or import a document under Knowledge and ask again.",
        confidence: 0,
        sources: [],
        extractive: true,
        stubbed: found.stubbed,
        model: "",
      },
    };
  }

  const { model: modelSources, view: sources } = toSources(found.hits);
  const prompt = buildBrainAnswerPrompt({ question, sources: modelSources });

  let answer = "";
  let confidence = 0;
  let citations: number[] = [];
  let extractive = false;
  let stubbed = false;
  let model = "";
  try {
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "brain_answer",
      promptVersion: BRAIN_ANSWER_PROMPT_VERSION,
      schema: brainAnswerSchema,
      toolName: "record_brain_answer",
      toolDescription: "Record the answer, the source numbers it relies on and the confidence.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 500,
      temperature: 0.2,
      cacheSystem: true,
    });
    stubbed = res.stubbed;
    model = res.model;
    if (res.data && res.data.answer.trim()) {
      answer = res.data.answer.trim().slice(0, 2_000);
      confidence = clampConfidence(res.data.confidence) ?? 0;
      citations = Array.from(
        new Set(res.data.citations.map((n) => Math.trunc(Number(n))).filter((n) => n >= 1 && n <= sources.length)),
      );
    } else {
      extractive = true;
      if (!res.stubbed) {
        await refund();
        log.warn("[brain-answer]", "answer returned no data", { organizationId, error: res.parseError });
      }
    }
  } catch (err) {
    extractive = true;
    await refund();
    log.error("[brain-answer]", "answer failed", { organizationId, error: err });
  }
  if (extractive) {
    answer = extractiveAnswer(found.hits);
    confidence = 0;
    citations = [1];
  }
  for (const s of sources) s.cited = citations.includes(s.n);

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "brain.answer",
    resourceType: "brain",
    metadata: {
      question: question.slice(0, 200),
      sources: sources.length,
      cited: citations,
      confidence,
      extractive,
      stubbed,
      model,
      promptVersion: BRAIN_ANSWER_PROMPT_VERSION,
    },
  });

  return {
    ok: true,
    view: { question, answer, confidence, sources, extractive, stubbed, model },
  };
}
