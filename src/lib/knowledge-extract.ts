/**
 * Phase 10c — Brain knowledge extraction.
 *
 *   knowledge_artifact.raw_text  →  AI gateway  →  candidate KB entries
 *
 * The output lands in knowledge_extraction_candidate as `decision: pending`,
 * not directly in knowledge_entry. A reviewer approves or rejects each
 * candidate. Approved candidates get promoted to real knowledge_entry
 * rows (and the candidate row records the link).
 */
import {
  buildKnowledgeExtractPrompt,
  knowledgeExtractionSchema,
  parseAiJson,
  type KnowledgeExtractionCandidateOutput,
  type KnowledgeKindEnumLike,
} from "@/lib/ai-prompts";
import { completeForTenant } from "@/lib/ai";
import { log } from "@/lib/log";

export type KnowledgeExtractOk = {
  ok: true;
  candidates: KnowledgeExtractionCandidateOutput[];
  notes: string;
  provider: string;
  model: string;
  stubbed: boolean;
};
export type KnowledgeExtractErr = { ok: false; error: string };

export const KNOWLEDGE_EXTRACT_PROMPT_VERSION = "kb-extract-v1";

const ALLOWED_KINDS: KnowledgeKindEnumLike[] = [
  "capability",
  "past_performance",
  "personnel",
  "boilerplate",
];

export async function aiExtractKnowledgeFromArtifact(input: {
  organizationId: string;
  artifactKind: string;
  artifactTitle: string;
  artifactTags: string[];
  rawText: string;
}): Promise<KnowledgeExtractOk | KnowledgeExtractErr> {
  if (!input.rawText.trim()) {
    return {
      ok: false,
      error:
        "Artifact has no text yet. Wait for indexing to complete (or images need vision OCR).",
    };
  }

  try {
    const prompt = buildKnowledgeExtractPrompt(input);
    const ai = await completeForTenant({
      organizationId: input.organizationId,
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 3500,
      temperature: 0.1,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      // Stub mode — return one demo candidate so the UI flow is testable
      // without an API key, but mark stubbed so the banner shows.
      return {
        ok: true,
        provider: ai.provider,
        model: ai.model,
        stubbed: true,
        candidates: [
          {
            kind: "boilerplate",
            title: "Stub-mode placeholder",
            body: "AI extraction is in stub mode. Set ANTHROPIC_API_KEY on Vercel to extract real candidates from this artifact.",
            tags: ["stub"],
            sourceExcerpt: input.rawText.slice(0, 200),
          },
        ],
        notes: "Stub provider — no real extraction performed.",
      };
    }

    const cleaned = stripCodeFences(ai.text);
    const parseResult = parseAiJson(cleaned, knowledgeExtractionSchema);
    if (!parseResult.ok) {
      log.error("[aiExtractKnowledgeFromArtifact]", "parse", { error: parseResult.error });
      return { ok: false, error: parseResult.error };
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      candidates: normalizeCandidates(parseResult.data.candidates),
      notes: parseResult.data.notes.slice(0, 1000),
    };
  } catch (err) {
    log.error("[aiExtractKnowledgeFromArtifact]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Extraction failed.",
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

function normalizeCandidates(
  raw: KnowledgeExtractionCandidateOutput[],
): KnowledgeExtractionCandidateOutput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => normalizeOne(c))
    .filter((c): c is KnowledgeExtractionCandidateOutput => c !== null)
    .slice(0, 12);
}

function normalizeOne(
  c: Partial<KnowledgeExtractionCandidateOutput> | null | undefined,
): KnowledgeExtractionCandidateOutput | null {
  if (!c || typeof c !== "object") return null;

  const kind = ALLOWED_KINDS.includes(c.kind as KnowledgeKindEnumLike)
    ? (c.kind as KnowledgeKindEnumLike)
    : null;
  if (!kind) return null;

  const title = clip(stringify(c.title), 200);
  const body = clip(stringify(c.body), 2500);
  if (!title.trim() || !body.trim()) return null;

  const tags = Array.isArray(c.tags)
    ? c.tags
        .map((t) => clip(stringify(t).toLowerCase(), 32))
        .filter((t) => t.length > 0)
        .slice(0, 8)
    : [];

  const sourceExcerpt = clip(stringify(c.sourceExcerpt), 600);

  // Metadata: keep only flat string/number/boolean entries, drop the rest.
  const metadata: Record<string, string | number | boolean> = {};
  if (c.metadata && typeof c.metadata === "object") {
    for (const [k, v] of Object.entries(c.metadata)) {
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        metadata[clip(k, 64)] = typeof v === "string" ? clip(v, 256) : v;
      }
    }
  }

  return { kind, title, body, tags, sourceExcerpt, metadata };
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
