/**
 * BL-AI-ROUTING — per-feature model routing.
 *
 * One model used to serve classification, OCR, extraction, drafting and
 * scan alike. That is wrong on both axes: cheap tasks overpay, and the
 * highest-stakes tasks (drafting, scan, winner analysis) cannot be
 * upgraded without upgrading everything. This module maps each AI
 * feature to a model *class* and each class to a concrete model for the
 * active provider.
 *
 * Precedence, highest first:
 *   1. Caller pinned `model` on the call — never overridden.
 *   2. Tenant override by feature key   (customOverrides.aiModels.section_draft)
 *   3. Tenant override by class key     (customOverrides.aiModels.strong)
 *   4. Provider table from env          (ANTHROPIC_MODEL_FAST / _MODEL / _MODEL_STRONG)
 *
 * Defaults are deliberately conservative: `standard` is whatever the
 * deployment already runs (ANTHROPIC_MODEL), `strong` falls back to
 * `standard` unless ANTHROPIC_MODEL_STRONG is set, so routing never
 * silently increases cost. `fast` defaults to Haiku because the fast
 * features are short, structured, and tolerant of a smaller model.
 *
 * Set AI_MODEL_ROUTING=off to disable and use the provider default for
 * every feature. Pure module: no DB, no server-only; the gateway passes
 * tenant overrides in.
 */
import type { AiFeature } from "@/lib/ai-features";
import type { AIProviderName } from "@/lib/ai";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const DEFAULT_ANTHROPIC_FAST_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_VLLM_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";

export type AiModelClass = "fast" | "standard" | "strong";

export const AI_MODEL_CLASSES: readonly AiModelClass[] = [
  "fast",
  "standard",
  "strong",
] as const;

export const AI_MODEL_CLASS_LABELS: Record<AiModelClass, string> = {
  fast: "Fast — short, structured, low stakes",
  standard: "Standard — everyday extraction, review, chat",
  strong: "Strong — drafting and high-stakes analysis",
};

/**
 * Feature → class. Every AiFeature must appear (the Record type
 * enforces it), so adding a feature forces a routing decision.
 */
export const AI_FEATURE_MODEL_CLASS: Record<AiFeature, AiModelClass> = {
  // Fast: small structured outputs where a compact model is adequate.
  knowledge_classify: "fast",
  image_ocr: "fast",
  ebuy_extract: "fast",
  gsa_extract: "fast",
  // Standard: everyday extraction, review, mapping and chat.
  opportunity_brief: "standard",
  pipeline_brief: "standard",
  section_chat: "standard",
  solicitation_extract: "standard",
  knowledge_extract: "standard",
  solicitation_review: "standard",
  capability_matrix: "standard",
  question_generator: "standard",
  compliance_preflight: "standard",
  compliance_automap: "standard",
  // Strong: what the customer submits or decides on.
  section_draft: "strong",
  proposal_scan: "strong",
  proposal_scan_background: "strong",
  winner_analysis: "strong",
  protest_viability: "strong",
};

/** Class → concrete model for a provider. `null` = leave the provider default. */
export type ModelRoutingTable = Record<AiModelClass, string | null>;

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function routingEnabled(): boolean {
  return (readEnv("AI_MODEL_ROUTING") ?? "on").toLowerCase() !== "off";
}

/**
 * Resolve the class table for a provider from env.
 *
 * Azure OpenAI is deployment-pinned (the deployment *is* the model), so
 * it gets no routing. Bedrock is not wired. Stub ignores models.
 */
export function modelTableFor(provider: AIProviderName): ModelRoutingTable {
  switch (provider) {
    case "anthropic": {
      const standard = readEnv("ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_MODEL;
      return {
        fast: readEnv("ANTHROPIC_MODEL_FAST") ?? DEFAULT_ANTHROPIC_FAST_MODEL,
        standard,
        strong: readEnv("ANTHROPIC_MODEL_STRONG") ?? standard,
      };
    }
    case "vllm": {
      const standard = readEnv("VLLM_MODEL") ?? DEFAULT_VLLM_MODEL;
      return {
        fast: readEnv("VLLM_MODEL_FAST") ?? standard,
        standard,
        strong: readEnv("VLLM_MODEL_STRONG") ?? standard,
      };
    }
    case "azure":
    case "bedrock":
    case "stub":
    default:
      return { fast: null, standard: null, strong: null };
  }
}

/**
 * Per-tenant model overrides, stored in tenant_subscription.custom_overrides
 * under `aiModels`. Keys may be feature keys or class keys.
 */
export type AiModelOverrides = Record<string, string>;

export type ModelRouteSource =
  | "tenant_feature"
  | "tenant_class"
  | "provider_table"
  | "none";

export type ModelRoute = {
  /** Model to request, or null to leave the provider default. */
  model: string | null;
  modelClass: AiModelClass;
  source: ModelRouteSource;
};

export function resolveModelForFeature(input: {
  feature: AiFeature;
  provider: AIProviderName;
  tenantOverrides?: AiModelOverrides | null;
}): ModelRoute {
  const modelClass = AI_FEATURE_MODEL_CLASS[input.feature];
  const overrides = input.tenantOverrides ?? {};

  const byFeature = cleanModel(overrides[input.feature]);
  if (byFeature) return { model: byFeature, modelClass, source: "tenant_feature" };

  const byClass = cleanModel(overrides[modelClass]);
  if (byClass) return { model: byClass, modelClass, source: "tenant_class" };

  const table = modelTableFor(input.provider);
  const fromTable = table[modelClass];
  return fromTable
    ? { model: fromTable, modelClass, source: "provider_table" }
    : { model: null, modelClass, source: "none" };
}

function cleanModel(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
