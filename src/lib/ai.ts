/**
 * FORGE AI gateway.
 *
 * Provider-agnostic chat-completion interface. The active provider is
 * selected by the AI_PROVIDER env var (anthropic / bedrock / azure /
 * vllm / stub). Each provider falls back to "stub" when its required
 * env vars are missing, so dev and preview work without credentials.
 *
 * Anthropic is implemented via direct fetch to api.anthropic.com so we
 * don't pull in the SDK for a single endpoint. Bedrock requires AWS
 * SigV4 signing and is left as a deliberate stub until we need it.
 *
 * BL-AI-TOOLS — structured output. A caller that wants JSON passes a
 * zod schema to `completeStructuredForTenant`. The gateway turns it into
 * a single forced tool call on providers that support tools (Anthropic,
 * Azure OpenAI, vLLM when VLLM_SUPPORTS_TOOLS=1) so the model returns a
 * typed object rather than prose we have to brace-hunt through. On other
 * providers, or when a tool call does not come back, it falls back to
 * extracting JSON from the text. Either way the payload is validated
 * against the schema and the outcome is recorded in ai_call_log.
 */

import { z } from "zod";
import type { AiFeature } from "@/lib/ai-features";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_VLLM_MODEL = "meta-llama/Meta-Llama-3-8B-Instruct";

export type AIRole = "user" | "assistant";

export type AIMessage = {
  role: AIRole;
  content: string;
};

/**
 * A binary document attached to the user turn. Anthropic supports PDF
 * via document content blocks and images (jpeg/png/webp/gif) via image
 * content blocks. Other providers receive the user prompt without the
 * attachment and should gracefully degrade.
 */
export type AIDocumentMedia =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export type AIDocument = {
  /** Filesystem-style hint for the model — surfaced inside the prompt. */
  name?: string;
  mediaType: AIDocumentMedia;
  /** Raw bytes — the gateway base64-encodes per provider. */
  bytes: Uint8Array;
};

/**
 * BL-AI-TOOLS — a single tool the model is forced to call. `inputSchema`
 * is JSON Schema with an object at the root (Anthropic and OpenAI both
 * require that). Build it with `zodToToolSchema`.
 */
export type AIToolSpec = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type AICompleteOptions = {
  system?: string;
  messages: AIMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * If true, the system prompt is sent with cache_control on
   * Anthropic so repeat calls with the same system text hit
   * the prompt cache.
   */
  cacheSystem?: boolean;
  /**
   * Documents attached to the FIRST user message. Anthropic-only for
   * now (PDF document blocks). Other providers receive a synthesized
   * note in place of the document.
   */
  documents?: AIDocument[];
  /**
   * BL-AI-TOOLS — when set, the provider is asked to answer by calling
   * this tool (forced). The tool input comes back in `structured`.
   * Providers without tool support ignore it and answer in text.
   */
  tool?: AIToolSpec;
};

export type AICompleteResult = {
  text: string;
  provider: AIProviderName;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** True when the call used the StubProvider (no live AI). */
  stubbed: boolean;
  /** BL-AI-TOOLS — the tool input object when the provider answered via the forced tool. */
  structured?: unknown;
  /** Provider stop / finish reason, when reported. */
  stopReason?: string;
};

export type AIProviderName = "anthropic" | "bedrock" | "azure" | "vllm" | "stub";

export type AIProviderStatus = {
  name: AIProviderName;
  configured: boolean;
  reason: string;
};

export interface AIProvider {
  readonly name: AIProviderName;
  complete(opts: AICompleteOptions): Promise<AICompleteResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Anthropic request / response shaping. Exported with a __ prefix so
// tests can pin the wire format without a network call.
// ─────────────────────────────────────────────────────────────────────

export function __buildAnthropicBody(
  opts: AICompleteOptions,
  model: string,
): Record<string, unknown> {
  const docs = opts.documents ?? [];
  let firstUserSeen = false;
  const messages = opts.messages.map((m) => {
    if (m.role === "user" && !firstUserSeen && docs.length > 0) {
      firstUserSeen = true;
      const blocks: unknown[] = docs.map((d) => {
        // Anthropic uses different block types for PDF vs image.
        // PDFs go through "document"; images through "image".
        if (d.mediaType === "application/pdf") {
          return {
            type: "document",
            source: {
              type: "base64",
              media_type: d.mediaType,
              data: bytesToBase64(d.bytes),
            },
            ...(d.name ? { title: d.name } : {}),
          };
        }
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: d.mediaType,
            data: bytesToBase64(d.bytes),
          },
        };
      });
      blocks.push({ type: "text", text: m.content });
      return { role: m.role, content: blocks };
    }
    return { role: m.role, content: m.content };
  });
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    messages,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (opts.system) {
    body.system = opts.cacheSystem
      ? [
          {
            type: "text",
            text: opts.system,
            cache_control: { type: "ephemeral" },
          },
        ]
      : opts.system;
  }
  if (opts.tool) {
    body.tools = [
      {
        name: opts.tool.name,
        description:
          opts.tool.description ?? "Return the result as structured data.",
        input_schema: opts.tool.inputSchema,
      },
    ];
    // Force exactly this tool, exactly once.
    body.tool_choice = {
      type: "tool",
      name: opts.tool.name,
      disable_parallel_tool_use: true,
    };
  }
  return body;
}

type AnthropicResponse = {
  content?: { type: string; text?: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  stop_reason?: string;
};

export function __parseAnthropicResponse(
  json: AnthropicResponse,
  fallbackModel: string,
): Omit<AICompleteResult, "provider" | "stubbed"> {
  const blocks = json.content ?? [];
  const text = blocks
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  const toolBlock = blocks.find((c) => c.type === "tool_use");
  return {
    text,
    model: json.model ?? fallbackModel,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
    structured: toolBlock ? toolBlock.input : undefined,
    stopReason: json.stop_reason,
  };
}

class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  constructor(
    private apiKey: string,
    private defaultModel = DEFAULT_ANTHROPIC_MODEL,
  ) {}

  async complete(opts: AICompleteOptions): Promise<AICompleteResult> {
    const model = opts.model ?? this.defaultModel;
    const body = __buildAnthropicBody(opts, model);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const json = (await res.json()) as AnthropicResponse;
    return {
      ...__parseAnthropicResponse(json, model),
      provider: this.name,
      stubbed: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// OpenAI-compatible request / response shaping — shared by Azure OpenAI
// and vLLM. Same __ export convention for tests.
// ─────────────────────────────────────────────────────────────────────

export function __buildOpenAiCompatBody(
  opts: AICompleteOptions,
  includeTools: boolean,
  model?: string,
): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  for (const m of opts.messages) messages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    messages,
    max_tokens: opts.maxTokens ?? 1024,
  };
  if (model) body.model = model;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (opts.tool && includeTools) {
    body.tools = [
      {
        type: "function",
        function: {
          name: opts.tool.name,
          description:
            opts.tool.description ?? "Return the result as structured data.",
          parameters: opts.tool.inputSchema,
        },
      },
    ];
    body.tool_choice = { type: "function", function: { name: opts.tool.name } };
  }
  return body;
}

type OpenAiCompatResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function __parseOpenAiCompatResponse(
  json: OpenAiCompatResponse,
  fallbackModel: string,
): Omit<AICompleteResult, "provider" | "stubbed"> {
  const choice = json.choices?.[0];
  const text = choice?.message?.content?.trim() ?? "";
  let structured: unknown = undefined;
  const args = choice?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args === "string" && args.trim()) {
    try {
      structured = JSON.parse(args);
    } catch {
      // Malformed arguments — leave undefined so the caller's text
      // fallback gets a chance, and validation reports the failure.
    }
  }
  return {
    text,
    model: json.model ?? fallbackModel,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    structured,
    stopReason: choice?.finish_reason,
  };
}

class AzureOpenAIProvider implements AIProvider {
  readonly name = "azure" as const;
  constructor(
    private endpoint: string,
    private apiKey: string,
    private deployment: string,
    private apiVersion: string,
  ) {}

  async complete(opts: AICompleteOptions): Promise<AICompleteResult> {
    const url = `${this.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(
      this.deployment,
    )}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`;

    // Azure deployments are model-pinned; the model is the deployment.
    const body = __buildOpenAiCompatBody(opts, true);

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Azure OpenAI ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const json = (await res.json()) as OpenAiCompatResponse;
    return {
      ...__parseOpenAiCompatResponse(json, this.deployment),
      provider: this.name,
      stubbed: false,
    };
  }
}

class VLLMProvider implements AIProvider {
  readonly name = "vllm" as const;
  constructor(
    private baseUrl: string,
    private apiKey: string | null,
    private defaultModel = DEFAULT_VLLM_MODEL,
    // Tool calling on vLLM depends on the served model and the
    // --enable-auto-tool-choice flag; opt in explicitly.
    private supportsTools = false,
  ) {}

  async complete(opts: AICompleteOptions): Promise<AICompleteResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const model = opts.model ?? this.defaultModel;
    const body = __buildOpenAiCompatBody(opts, this.supportsTools, model);

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`vLLM ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const json = (await res.json()) as OpenAiCompatResponse;
    return {
      ...__parseOpenAiCompatResponse(json, model),
      provider: this.name,
      stubbed: false,
    };
  }
}

class BedrockNotWiredProvider implements AIProvider {
  readonly name = "bedrock" as const;
  async complete(): Promise<AICompleteResult> {
    throw new Error(
      "Bedrock provider is selected but not yet wired. " +
        "Bedrock needs AWS SigV4 signing — install @aws-sdk/client-bedrock-runtime " +
        "and replace the BedrockNotWiredProvider class in src/lib/ai.ts.",
    );
  }
}

class StubProvider implements AIProvider {
  readonly name = "stub" as const;
  constructor(private reason: string) {}

  async complete(opts: AICompleteOptions): Promise<AICompleteResult> {
    const lastUser =
      [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const preview = lastUser.slice(0, 240);
    const text = [
      "FORGE AI is currently running in stub mode (no provider configured).",
      this.reason ? `Reason: ${this.reason}` : "",
      "",
      "When a provider is configured, this is where the model's response would appear.",
      preview ? `\nLast user prompt preview:\n> ${preview}${lastUser.length > 240 ? "…" : ""}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      text,
      provider: this.name,
      model: "stub-1",
      inputTokens: 0,
      outputTokens: 0,
      stubbed: true,
    };
  }
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Buffer is the safe path on Node; chunked to avoid stack issues for big
  // PDFs (~10 MB). The Anthropic API caps documents at 32 MB anyway.
  return Buffer.from(bytes).toString("base64");
}

/**
 * Returns the configured provider plus a status report for every
 * supported provider — useful for the /intelligence settings panel.
 */
export function getAIProviderStatus(): {
  active: AIProviderStatus;
  all: AIProviderStatus[];
} {
  const requested = (readEnv("AI_PROVIDER") ?? "anthropic").toLowerCase();

  const all: AIProviderStatus[] = [
    statusFor("anthropic"),
    statusFor("bedrock"),
    statusFor("azure"),
    statusFor("vllm"),
  ];

  const requestedStatus = all.find((s) => s.name === requested);
  let active: AIProviderStatus;
  if (requested === "stub") {
    active = { name: "stub", configured: true, reason: "Stub explicitly selected" };
  } else if (requestedStatus?.configured) {
    active = requestedStatus;
  } else {
    active = {
      name: "stub",
      configured: true,
      reason: requestedStatus
        ? `Falling back: ${requestedStatus.reason}`
        : `Unknown AI_PROVIDER="${requested}", falling back to stub`,
    };
  }

  return { active, all };
}

function statusFor(name: AIProviderName): AIProviderStatus {
  switch (name) {
    case "anthropic": {
      const key = readEnv("ANTHROPIC_API_KEY");
      return key
        ? { name, configured: true, reason: "ANTHROPIC_API_KEY present" }
        : { name, configured: false, reason: "ANTHROPIC_API_KEY not set" };
    }
    case "bedrock":
      return {
        name,
        configured: false,
        reason:
          "Bedrock provider needs @aws-sdk/client-bedrock-runtime + SigV4 — class is currently a deliberate stub",
      };
    case "azure": {
      const endpoint = readEnv("AZURE_OPENAI_ENDPOINT");
      const key = readEnv("AZURE_OPENAI_API_KEY");
      const deployment = readEnv("AZURE_OPENAI_DEPLOYMENT");
      const missing = [
        !endpoint && "AZURE_OPENAI_ENDPOINT",
        !key && "AZURE_OPENAI_API_KEY",
        !deployment && "AZURE_OPENAI_DEPLOYMENT",
      ].filter(Boolean) as string[];
      return missing.length
        ? { name, configured: false, reason: `Missing: ${missing.join(", ")}` }
        : { name, configured: true, reason: "All Azure OpenAI vars present" };
    }
    case "vllm": {
      const base = readEnv("VLLM_BASE_URL");
      return base
        ? { name, configured: true, reason: `VLLM_BASE_URL=${base}` }
        : { name, configured: false, reason: "VLLM_BASE_URL not set" };
    }
    case "stub":
      return { name, configured: true, reason: "Stub is always available" };
  }
}

export function getAIProvider(): AIProvider {
  const { active } = getAIProviderStatus();
  switch (active.name) {
    case "anthropic":
      return new AnthropicProvider(
        readEnv("ANTHROPIC_API_KEY")!,
        readEnv("ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_MODEL,
      );
    case "azure":
      return new AzureOpenAIProvider(
        readEnv("AZURE_OPENAI_ENDPOINT")!,
        readEnv("AZURE_OPENAI_API_KEY")!,
        readEnv("AZURE_OPENAI_DEPLOYMENT")!,
        readEnv("AZURE_OPENAI_API_VERSION") ?? "2024-08-01-preview",
      );
    case "vllm":
      return new VLLMProvider(
        readEnv("VLLM_BASE_URL")!,
        readEnv("VLLM_API_KEY"),
        readEnv("VLLM_MODEL") ?? DEFAULT_VLLM_MODEL,
        readEnv("VLLM_SUPPORTS_TOOLS") === "1",
      );
    case "bedrock":
      return new BedrockNotWiredProvider();
    case "stub":
    default:
      return new StubProvider(active.reason);
  }
}

export async function complete(opts: AICompleteOptions): Promise<AICompleteResult> {
  return getAIProvider().complete(opts);
}

// Test seam: in production this is exactly `complete`. Tests that want
// to control the provider's return shape without setting up real API
// keys can swap this via __setCompleteImplForTest. Internal callers
// (completeForTenant) call through this indirection so the swap takes
// effect — vi.mock cannot reach in-module references to `complete`.
let _completeImpl: typeof complete = complete;
export function __setCompleteImplForTest(fn: typeof complete | null): void {
  _completeImpl = fn ?? complete;
}

// ─────────────────────────────────────────────────────────────────────
// BL-AI-TOOLS — schema helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a zod schema into the JSON Schema a tool `input_schema` needs.
 * Uses zod 4's built-in exporter in "input" mode (the model produces the
 * *input* to our validator). Root must be an object — both Anthropic and
 * OpenAI reject anything else, so we fail fast at build time rather than
 * at the provider.
 */
export function zodToToolSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== "object") {
    throw new Error(
      "zodToToolSchema: tool input schemas must be an object at the root",
    );
  }
  return json;
}

export type AIStructuredValidation<T> = {
  /** Validated payload, or null when validation failed. */
  data: T | null;
  /** Human-readable reason when `data` is null. */
  parseError: string | null;
  /** True when the payload came from the provider's tool-call path. */
  viaTool: boolean;
};

function describeIssues(err: z.ZodError): string {
  const issues = err.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return `AI response didn't match the expected shape (${issues}).`;
}

/**
 * Validate a completion against a schema. Prefers the tool-call payload;
 * falls back to extracting the outermost JSON object from the text for
 * providers that answered in prose.
 */
export function validateStructured<T>(
  schema: z.ZodType<T>,
  result: AICompleteResult,
): AIStructuredValidation<T> {
  if (result.structured !== undefined) {
    const parsed = schema.safeParse(result.structured);
    return parsed.success
      ? { data: parsed.data, parseError: null, viaTool: true }
      : { data: null, parseError: describeIssues(parsed.error), viaTool: true };
  }

  const raw = result.text ?? "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const slice = start === -1 || end < start ? raw : raw.slice(start, end + 1);
  let json: unknown;
  try {
    json = JSON.parse(slice);
  } catch {
    return {
      data: null,
      parseError: "AI response was not valid JSON.",
      viaTool: false,
    };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { data: parsed.data, parseError: null, viaTool: false }
    : { data: null, parseError: describeIssues(parsed.error), viaTool: false };
}

function sanitizeToolName(name: string): string {
  // Anthropic: ^[a-zA-Z0-9_-]{1,64}$. OpenAI is compatible with that.
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return cleaned || "result";
}

// ─────────────────────────────────────────────────────────────────────
// Tenant-gated completion
// ─────────────────────────────────────────────────────────────────────

/**
 * BL-AI-TELEMETRY — options for tenant-gated calls. `feature` is
 * required so every call site declares the product surface it serves;
 * TypeScript refuses a call that forgets. Stored in ai_call_log.
 */
export type AITenantCompleteOptions = AICompleteOptions & {
  organizationId: string;
  /** Product surface making the call (see src/lib/ai-features.ts). */
  feature: AiFeature;
  /** Optional sub-mode — draft mode, extraction path, review kind. */
  variant?: string;
  /** Optional prompt revision tag so prompt changes are comparable. */
  promptVersion?: string;
};

type TenantRun<T> = {
  result: AICompleteResult;
  validation: AIStructuredValidation<T> | null;
};

/**
 * Shared implementation behind `completeForTenant` and
 * `completeStructuredForTenant`. Runs the quota pre-check, the provider
 * call, optional schema validation, telemetry, and the usage post-record.
 * Validation happens here rather than in the caller so the parse outcome
 * lands on the same ai_call_log row as the call itself.
 */
async function runTenantCompletion<T>(
  opts: AITenantCompleteOptions,
  validate: ((result: AICompleteResult) => AIStructuredValidation<T>) | null,
): Promise<TenantRun<T>> {
  const { organizationId, feature, variant, promptVersion, ...rest } = opts;
  // Dynamic imports keep the AI gateway free of a hard dep on the
  // subscription-gates / telemetry modules — useful for the future
  // ingest / worker contexts that may use this file without them.
  const { enforceQuota, getCurrentUsage, getCurrentTier, QuotaExceededError } =
    await import("@/lib/subscription-gates");
  const { recordAiCall } = await import("@/lib/ai-telemetry");

  // BL-AI-TELEMETRY — fields common to every outcome row.
  const telemetryBase = {
    organizationId,
    feature,
    variant,
    promptVersion,
    requestedModel: rest.model ?? "",
    maxTokens: rest.maxTokens ?? null,
    cacheSystem: rest.cacheSystem ?? false,
    hasDocuments: (rest.documents?.length ?? 0) > 0,
  };

  // Pre-check: refuse before calling the provider when the tenant is
  // already over their token cap. The check is best-effort — a tenant
  // can sneak one final call through if multiple workers race past the
  // threshold simultaneously; same advisory-ceiling semantics as the
  // existing request-count quota.
  const tier = await getCurrentTier(organizationId);
  if (tier && tier.effectiveQuotas.aiTokensPerMonth > 0) {
    const used = await getCurrentUsage(organizationId, "aiTokensPerMonth");
    if (used >= tier.effectiveQuotas.aiTokensPerMonth) {
      // Refusals are demand we could not serve — worth counting.
      await recordAiCall({
        ...telemetryBase,
        status: "quota_refused",
        latencyMs: 0,
        error: `aiTokensPerMonth cap ${tier.effectiveQuotas.aiTokensPerMonth} reached (${used} used)`,
      });
      throw new QuotaExceededError(
        "aiTokensPerMonth",
        tier.effectiveQuotas.aiTokensPerMonth,
        used,
        tier.tierName,
      );
    }
  }

  // Latency is measured around the provider call only, so the number
  // compares models rather than our own DB round-trips.
  const providerStartedAt = Date.now();
  let result: AICompleteResult;
  try {
    result = await _completeImpl(rest);
  } catch (err) {
    await recordAiCall({
      ...telemetryBase,
      status: "error",
      latencyMs: Date.now() - providerStartedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const validation = validate ? validate(result) : null;

  await recordAiCall({
    ...telemetryBase,
    status: "ok",
    latencyMs: Date.now() - providerStartedAt,
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
    outputChars: result.text.length,
    stubbed: result.stubbed,
    viaTool: result.structured !== undefined,
    // Stub prose can never validate; don't count it as a parse failure.
    parseOk: validation && !result.stubbed ? validation.parseError === null : null,
    parseError: validation?.parseError ?? null,
  });

  // Post-record: atomically add this call's actual token usage. The
  // helper itself throws `QuotaExceededError` if the new total exceeds
  // the cap — that's *informational* on the post-record path; the call
  // succeeded and the tenant paid, so we let the result flow through
  // but the next call into this code path will be refused at pre-check.
  const tokens =
    (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
  if (tokens > 0) {
    try {
      await enforceQuota(organizationId, "aiTokensPerMonth", tokens);
    } catch (err) {
      // Counter went over after this call — log so admins notice but
      // don't fail the response; the user already paid for this call's
      // output. The next call will be refused at pre-check.
      const { log } = await import("@/lib/log");
      log.warn("[completeForTenant]", "tenant just crossed token cap", {
        organizationId,
        tokens,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { result, validation };
}

/**
 * BL-PACKAGES Slice 1 — tenant-gated AI completion.
 *
 * Use this in EVERY server action or API route that runs AI on behalf
 * of a tenant. The plain `complete()` above remains for unkeyed contexts
 * (cron + future ingest pipelines that don't have an `organizationId`),
 * but the long-term goal is for those callers to migrate too so we have
 * full per-tenant cost visibility.
 *
 * Enforcement model:
 *   1. **Pre-check.** Read the tenant's current `aiTokensPerMonth`
 *      usage and the effective quota. If usage is already ≥ the
 *      cap, refuse the call with `QuotaExceededError` before any
 *      provider request fires (no wasted dollar).
 *   2. **Provider call.** Identical to `complete()` — same provider,
 *      same shape, same return.
 *   3. **Post-record.** On success, atomically add the actual
 *      `inputTokens + outputTokens` to the counter via the existing
 *      `enforceQuota` machinery. Concurrent calls compose correctly.
 *
 * Why post-record rather than pre-reserve: tokens aren't known until
 * the provider responds, and the worst overshoot is bounded by a
 * single call's max_tokens (default 1024, capped at 4-8k in practice).
 * For Bronze/Free tiers with small caps we lose at most one call of
 * over-budget tokens — well below the cost of a failed reserve
 * + reconcile dance.
 *
 * Failure modes:
 *   - No subscription row → throws (deny-by-default, same as the
 *     existing `ensureFeature` posture)
 *   - Quota = 0 (unlimited) → no counter increment; the
 *     `enforceQuota` helper already short-circuits in this case
 *   - Stub provider returns 0 tokens → no counter increment;
 *     fine, the stub doesn't cost anything
 *   - Provider call throws → counter is NOT incremented; aligns
 *     with "you don't pay for failed calls"
 */
export async function completeForTenant(
  opts: AITenantCompleteOptions,
): Promise<AICompleteResult> {
  const { result } = await runTenantCompletion<never>(opts, null);
  return result;
}

export type AIStructuredOptions<T> = AITenantCompleteOptions & {
  /** Shape the model must return. Root must be a zod object. */
  schema: z.ZodType<T>;
  /** Tool name shown to the model; defaults to `<feature>_result`. */
  toolName?: string;
  /** One line telling the model what the tool records. */
  toolDescription?: string;
};

export type AIStructuredResult<T> = AICompleteResult & AIStructuredValidation<T>;

/**
 * BL-AI-TOOLS — tenant-gated completion that returns a validated object.
 *
 * Same gates, telemetry and quota semantics as `completeForTenant`. The
 * schema becomes a forced tool call on tool-capable providers; otherwise
 * the text is JSON-extracted. `data` is null when validation fails —
 * callers decide whether that is retryable, a refund, or a hard error.
 * Check `stubbed` before `data`: the stub provider never validates.
 */
export async function completeStructuredForTenant<T>(
  opts: AIStructuredOptions<T>,
): Promise<AIStructuredResult<T>> {
  const { schema, toolName, toolDescription, ...rest } = opts;
  const tool: AIToolSpec = {
    name: sanitizeToolName(toolName ?? `${rest.feature}_result`),
    description:
      toolDescription ??
      "Record the result as structured data matching the schema exactly.",
    inputSchema: zodToToolSchema(schema),
  };
  const { result, validation } = await runTenantCompletion<T>(
    { ...rest, tool },
    (r) => validateStructured(schema, r),
  );
  const v = validation ?? { data: null, parseError: "No validation ran.", viaTool: false };
  return { ...result, ...v };
}
