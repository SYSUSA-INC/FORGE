import { Panel } from "@/components/ui/Panel";
import type { AIProviderName, AIProviderStatus } from "@/lib/ai";

const PROVIDER_LABELS: Record<AIProviderName, string> = {
  anthropic: "Anthropic",
  bedrock: "AWS Bedrock",
  azure: "Azure OpenAI",
  vllm: "vLLM (self-hosted)",
  stub: "Stub (no AI)",
};

const PROVIDER_HINTS: Record<AIProviderName, string> = {
  anthropic: "Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL).",
  bedrock:
    "Install @aws-sdk/client-bedrock-runtime and replace BedrockNotWiredProvider in src/lib/ai.ts.",
  azure:
    "Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT (+ AZURE_OPENAI_API_VERSION).",
  vllm: "Set VLLM_BASE_URL (and optionally VLLM_API_KEY, VLLM_MODEL).",
  stub: "Always available. Returns a deterministic placeholder.",
};

export function ProviderStatusPanel({
  active,
  all,
}: {
  active: AIProviderStatus;
  all: AIProviderStatus[];
}) {
  return (
    <Panel
      title="AI provider"
      eyebrow="Switchable gateway"
      actions={
        <span
          className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
            active.name === "stub"
              ? "border-rose/40 bg-rose/10 text-rose"
              : "border-emerald/40 bg-emerald/10 text-emerald"
          }`}
        >
          {PROVIDER_LABELS[active.name]}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="font-body text-[12px] leading-relaxed text-muted">
          Active provider:{" "}
          <span className="text-text">{PROVIDER_LABELS[active.name]}</span>.
          Switch with the <code className="text-teal">AI_PROVIDER</code> env
          var (anthropic / bedrock / azure / vllm / stub). Missing credentials
          fall back to stub so dev and preview always work.
        </p>

        <ul className="flex flex-col gap-2">
          {all.map((p) => (
            <li
              key={p.name}
              className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <span
                className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                  p.configured ? "bg-emerald" : "bg-subtle/60"
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-[13px] font-semibold text-text">
                    {PROVIDER_LABELS[p.name]}
                  </span>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-widest ${
                      p.configured ? "text-emerald" : "text-subtle"
                    }`}
                  >
                    {p.configured ? "ready" : "unconfigured"}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted">
                  {p.reason}
                </div>
                <div className="mt-1 font-body text-[11px] leading-relaxed text-subtle">
                  {PROVIDER_HINTS[p.name]}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
