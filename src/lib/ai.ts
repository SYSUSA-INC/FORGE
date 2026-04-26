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
    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? 1024,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
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
