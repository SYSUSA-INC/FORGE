/**
 * BL-10 Phase A — AI-based artifact kind classification.
 *
 * Takes a file's extracted text and returns a suggested
 * `KnowledgeArtifactKind` (one of 15 enum values) plus a confidence
 * score. Used by the upload pipeline when the user picks "Auto-detect"
 * so the kind is content-based rather than file-extension-based.
 *
 * Stub-mode contract: when no AI provider is configured, returns
 * `{ ok: true, stubbed: true }` with kind="other" and confidence=0.
 * Callers should check `stubbed` and skip applying the result when
 * true — the file-extension heuristic in `defaultKindFromFormat`
 * stays the better answer in stub mode.
 *
 * Confidence threshold (suggested for callers): 0.6. Below that, the
 * classifier is too uncertain to override the heuristic.
 */
import {
  artifactKindClassifySchema,
  buildArtifactKindClassifyPrompt,
  parseAiJson,
} from "@/lib/ai-prompts";
import { complete } from "@/lib/ai";
import { log } from "@/lib/log";
import type { KnowledgeArtifactKind } from "@/db/schema";

export type ClassifyArtifactKindOk = {
  ok: true;
  kind: KnowledgeArtifactKind;
  confidence: number;
  reasoning: string;
  stubbed: boolean;
  provider: string;
  model: string;
};
export type ClassifyArtifactKindErr = { ok: false; error: string };
export type ClassifyArtifactKindResult =
  | ClassifyArtifactKindOk
  | ClassifyArtifactKindErr;

export const CLASSIFY_CONFIDENCE_THRESHOLD = 0.6;

export async function classifyArtifactKind(input: {
  fileName: string;
  contentType: string;
  rawText: string;
}): Promise<ClassifyArtifactKindResult> {
  if (!input.rawText.trim()) {
    return {
      ok: false,
      error:
        "Cannot classify — extracted text is empty (image-only file with no OCR, or extraction failed).",
    };
  }

  try {
    const prompt = buildArtifactKindClassifyPrompt(input);
    const ai = await complete({
      system: prompt.system,
      messages: prompt.messages,
      // Classification is short — 200 tokens covers JSON {kind, confidence, reasoning}.
      maxTokens: 200,
      temperature: 0.1,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      // Stub mode — return "other" / confidence=0 / stubbed=true. Callers
      // check `stubbed` and skip applying the result, preserving the
      // file-extension heuristic.
      return {
        ok: true,
        kind: "other",
        confidence: 0,
        reasoning: "Stub provider — no real classification performed.",
        stubbed: true,
        provider: ai.provider,
        model: ai.model,
      };
    }

    const cleaned = stripCodeFences(ai.text);
    const parsed = parseAiJson(cleaned, artifactKindClassifySchema);
    if (!parsed.ok) {
      log.error("[classifyArtifactKind]", "parse", { error: parsed.error });
      return { ok: false, error: parsed.error };
    }

    return {
      ok: true,
      kind: parsed.data.kind,
      confidence: parsed.data.confidence,
      reasoning: parsed.data.reasoning.slice(0, 300),
      stubbed: false,
      provider: ai.provider,
      model: ai.model,
    };
  } catch (err) {
    log.error("[classifyArtifactKind]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Classification failed.",
    };
  }
}

function stripCodeFences(t: string): string {
  const s = t.trim();
  if (s.startsWith("```")) {
    return s
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  return s;
}
