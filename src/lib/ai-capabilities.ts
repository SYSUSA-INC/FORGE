/**
 * BL-AIX Phase 1f — what each provider's model can do, and when a failed
 * call may move to the fallback provider. Pure; unit-tested.
 *
 * The table gates three things in the gateway:
 *   - maxTokens is clamped to the model's output ceiling, so a long
 *     request never earns a 400 from a smaller model;
 *   - a request with attached documents (PDF, images) only goes to a
 *     provider that reads them, instead of one that silently drops them;
 *   - the fallback provider is used only if it can serve the request
 *     (tools for structured calls, documents when attached).
 *
 * Ceilings are deliberately conservative defaults; an operator can set
 * AZURE_OPENAI_MAX_OUTPUT_TOKENS / VLLM_MAX_OUTPUT_TOKENS for a
 * deployment that allows more.
 */

export type CapabilityProvider = "anthropic" | "bedrock" | "azure" | "vllm" | "stub";

export type ModelCapabilities = {
  /** Forced tool calls (structured output). */
  tools: boolean;
  /** Inline PDF and image documents. */
  documents: boolean;
  /** Token-by-token streaming. */
  streaming: boolean;
  maxOutputTokens: number;
};

type Env = Record<string, string | undefined>;

function envInt(env: Env, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 256 ? Math.floor(n) : fallback;
}

export function capabilitiesFor(provider: CapabilityProvider, model: string, env: Env = {}): ModelCapabilities {
  const m = model.toLowerCase();
  switch (provider) {
    case "anthropic":
      return {
        tools: true,
        documents: true,
        streaming: true,
        // Claude 3 Haiku and 3.x Sonnet/Opus stop at 4k / 8k; current models allow far more.
        maxOutputTokens: /claude-3-haiku/.test(m) ? 4_096 : /claude-3(-5)?-(sonnet|opus)/.test(m) ? 8_192 : 32_000,
      };
    case "azure":
      return {
        tools: true,
        documents: false,
        streaming: false,
        maxOutputTokens: envInt(env, "AZURE_OPENAI_MAX_OUTPUT_TOKENS", /gpt-4\.1|gpt-5|o\d/.test(m) ? 32_768 : 16_384),
      };
    case "vllm":
      return {
        tools: env.VLLM_SUPPORTS_TOOLS === "1",
        documents: false,
        streaming: false,
        // Served models vary; 8k covers every current caller unclamped.
        maxOutputTokens: envInt(env, "VLLM_MAX_OUTPUT_TOKENS", 8_192),
      };
    case "bedrock":
      return { tools: false, documents: false, streaming: false, maxOutputTokens: 4_096 };
    case "stub":
      return { tools: true, documents: true, streaming: true, maxOutputTokens: 1_000_000 };
  }
}

export function clampMaxTokens(requested: number | undefined, caps: ModelCapabilities): number | undefined {
  return requested === undefined ? undefined : Math.min(requested, caps.maxOutputTokens);
}

/** Whether a provider can serve a request as it stands. */
export function canServe(caps: ModelCapabilities, request: { tool: boolean; documents: boolean }): boolean {
  return (!request.tool || caps.tools) && (!request.documents || caps.documents);
}

/** HTTP statuses that mean the provider is down or overloaded, not that the request is wrong. */
const OUTAGE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/**
 * A failure worth retrying on another provider: an overload or server
 * error that survived the per-provider retries, a missed deadline, or a
 * dropped connection. A bad request, a refused key or a content error is
 * not: another provider would only repeat it or hide a configuration fault.
 */
export function isFallbackEligible(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") return OUTAGE_STATUS.has(status) || status >= 500;
  if (err.name === "DeadlineError") return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|network/i.test(err.message);
}

/**
 * BL-AIX Phase 1i — how a Claude model's request surface differs by
 * generation. Newer models reject forced tool choice (Opus 5.5, Sonnet
 * 5.5, Fable 5.1, Mythos 5.1), reject `temperature` (Opus 4.7+, Sonnet 5+,
 * Fable, Mythos) and think by default (Opus 5+, Sonnet 5+, Fable, Mythos),
 * with the thinking counted against `max_tokens`. An id this cannot read
 * keeps today's request shape.
 */
export type ClaudeFamily = "opus" | "sonnet" | "haiku" | "fable" | "mythos";

/** Family and version from an id such as "claude-opus-5-5", "claude-haiku-4-5-20251001", "anthropic.claude-sonnet-4-6" or "claude-3-5-sonnet-20241022". */
export function claudeVersion(model: string): { family: ClaudeFamily; version: number } | null {
  const m = model.toLowerCase();
  const modern = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?=-|$|@|:)/.exec(m);
  if (modern) return { family: modern[1] as ClaudeFamily, version: Number(modern[2]) + (modern[3] ? Number(modern[3]) / 10 : 0) };
  const legacy = /claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)/.exec(m);
  if (legacy) return { family: legacy[3] as ClaudeFamily, version: Number(legacy[1]) + (legacy[2] ? Number(legacy[2]) / 10 : 0) };
  return null;
}

export type ClaudeSurface = {
  /** `tool_choice: {type: "tool"}` is accepted; otherwise the gateway asks for the tool in the prompt under `auto`. */
  forcedToolChoice: boolean;
  /** `temperature` is accepted; otherwise it is left out. */
  sampling: boolean;
  /** Thinks by default, so `max_tokens` needs room for the thinking as well as the answer. */
  thinksByDefault: boolean;
};

const LEGACY_SURFACE: ClaudeSurface = { forcedToolChoice: true, sampling: true, thinksByDefault: false };

export function claudeSurface(model: string): ClaudeSurface {
  const v = claudeVersion(model);
  if (!v) return LEGACY_SURFACE;
  const { family, version } = v;
  const newestLine = family === "fable" || family === "mythos";
  return {
    forcedToolChoice: !(
      (family === "opus" && version >= 5.5) ||
      (family === "sonnet" && version >= 5.5) ||
      (newestLine && version >= 5.1)
    ),
    sampling: !((family === "opus" && version >= 4.7) || (family === "sonnet" && version >= 5) || newestLine),
    thinksByDefault: (family === "opus" && version >= 5) || (family === "sonnet" && version >= 5) || newestLine,
  };
}

/** Thinking room added on top of the answer's budget for a model that thinks by default. */
export const THINKING_HEADROOM_MIN = 4_096;

export function thinkingMaxTokens(requested: number, ceiling: number): number {
  return Math.min(ceiling, requested + Math.max(THINKING_HEADROOM_MIN, requested));
}

/** Short and structured calls think briefly; longer prose keeps the model's default effort. */
export function thinkingEffort(input: { tool: boolean; maxTokens: number }): "low" | undefined {
  return input.tool || input.maxTokens <= 1_500 ? "low" : undefined;
}
