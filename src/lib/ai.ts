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
 */

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
};

export type AICompleteResult = {
  text: string;
  provider: AIProviderName;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** True when the call used the StubProvider (no live AI). */
  stubbed: boolean;
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

class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  constructor(
    private apiKey: string,
    private defaultModel = DEFAULT_ANTHROPIC_MODEL,
  ) {}

  async complete(opts: AICompleteOptions): Promise<AICompleteResult> {
    const model = opts.model ?? this.defaultModel;
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
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const text =
      json.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n")
        .trim() ?? "";
    return {
      text,
      provider: this.name,
      model: json.model ?? model,
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
      stubbed: false,
    };
  }
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

    const messages: { role: string; content: string }[] = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    for (const m of opts.messages) messages.push({ role: m.role, content: m.content });

    const body: Record<string, unknown> = {
      messages,
      max_tokens: opts.maxTokens ?? 1024,
    };
    if (typeof opts.temperature === "number") body.temperature = opts.temperature;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Azure OpenAI ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content?.trim() ?? "",
      provider: this.name,
      model: json.model ?? this.deployment,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
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
  ) {}

  async complete(opts: AICompleteOptions): Promise<AICompleteResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const messages: { role: string; content: string }[] = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    for (const m of opts.messages) messages.push({ role: m.role, content: m.content });

    const body: Record<string, unknown> = {
      model: opts.model ?? this.defaultModel,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
    };
    if (typeof opts.temperature === "number") body.temperature = opts.temperature;

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
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content?.trim() ?? "",
      provider: this.name,
      model: json.model ?? body.model as string,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
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
 * Why a separate function rather than parameter on `complete`: the
 * existing `complete()` has ~15 callers; threading `organizationId`
 * everywhere is a coordinated refactor (BL-PACKAGES Slice 2). Until
 * then, `completeForTenant` is the canonical path for new code AND
 * the migration target for old code.
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
  opts: AICompleteOptions & { organizationId: string },
): Promise<AICompleteResult> {
  const { organizationId, ...rest } = opts;
  // Dynamic import keeps the AI gateway free of a hard dep on the
  // subscription-gates module — useful for the future ingest /
  // worker contexts that may use this file without the gates layer.
  const { enforceQuota, getCurrentUsage, getCurrentTier, QuotaExceededError } =
    await import("@/lib/subscription-gates");

  // Pre-check: refuse before calling the provider when the tenant is
  // already over their token cap. The check is best-effort — a tenant
  // can sneak one final call through if multiple workers race past the
  // threshold simultaneously; same advisory-ceiling semantics as the
  // existing request-count quota.
  const tier = await getCurrentTier(organizationId);
  if (tier && tier.effectiveQuotas.aiTokensPerMonth > 0) {
    const used = await getCurrentUsage(organizationId, "aiTokensPerMonth");
    if (used >= tier.effectiveQuotas.aiTokensPerMonth) {
      throw new QuotaExceededError(
        "aiTokensPerMonth",
        tier.effectiveQuotas.aiTokensPerMonth,
        used,
        tier.tierName,
      );
    }
  }

  const result = await complete(rest);

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

  return result;
}
