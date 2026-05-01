"use client";

import { Panel } from "@/components/ui/Panel";
import type { AIEngineStatus } from "@/lib/settings-status";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  bedrock: "AWS Bedrock",
  azure: "Azure OpenAI",
  vllm: "vLLM (self-hosted)",
  stub: "Stub (no live AI)",
};

export function AIEngineTab({ status }: { status: AIEngineStatus }) {
  const liveFeatures = status.features.filter((f) => f.live).length;

  return (
    <>
      <Panel
        title="Active AI provider"
        eyebrow="Picked by AI_PROVIDER env var; falls back to stub if unconfigured"
      >
        <div className="aur-card-elevated px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-display text-[15px] font-semibold text-foreground">
              {PROVIDER_LABELS[status.active.name] ?? status.active.name}
            </span>
            {status.active.name === "stub" ? (
              <span className="aur-pill bg-amber-400/10 text-amber-200 border-amber-400/30">
                stub mode
              </span>
            ) : (
              <span className="aur-pill bg-emerald-400/10 text-emerald-300 border-emerald-400/30">
                live
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">
            Default model: <span className="text-foreground">{status.defaultModel}</span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">
            {status.active.reason}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
            All providers
          </div>
          <ul className="space-y-1">
            {status.providers.map((p) => (
              <li
                key={p.name}
                className="flex items-baseline justify-between font-body text-[13px]"
              >
                <span className="text-foreground">
                  {PROVIDER_LABELS[p.name] ?? p.name}
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    p.configured ? "text-emerald" : "text-muted"
                  }`}
                >
                  {p.configured ? "configured" : p.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel
        title="AI features"
        eyebrow={`${liveFeatures} of ${status.features.length} live`}
      >
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Each AI feature degrades to stub mode when its underlying provider
          isn&apos;t configured. Stub mode returns deterministic placeholder
          output so dev and preview environments keep working — the UI
          banners red/amber when this happens so it&apos;s never confused
          with live output.
        </p>
        <ul className="mt-3 space-y-2">
          {status.features.map((f) => (
            <li key={f.key} className="aur-card-elevated px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[14px] font-semibold text-foreground">
                      {f.name}
                    </span>
                    {f.live ? (
                      <span className="aur-pill bg-emerald-400/10 text-emerald-300 border-emerald-400/30">
                        live
                      </span>
                    ) : (
                      <span className="aur-pill bg-amber-400/10 text-amber-200 border-amber-400/30">
                        stub
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-body text-[13px] leading-relaxed text-muted">
                    {f.description}
                  </div>
                  <div
                    className={`mt-1 font-mono text-[11px] ${
                      f.live ? "text-emerald" : "text-amber-200"
                    }`}
                  >
                    {f.detail}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Embeddings" eyebrow="Vector index for the Brain">
        <div className="aur-card-elevated px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-display text-[14px] font-semibold text-foreground">
              OpenAI text-embedding-3-small
            </span>
            {status.embeddingsConfigured ? (
              <span className="aur-pill bg-emerald-400/10 text-emerald-300 border-emerald-400/30">
                live
              </span>
            ) : (
              <span className="aur-pill bg-amber-400/10 text-amber-200 border-amber-400/30">
                stub
              </span>
            )}
          </div>
          <div className="mt-1 font-body text-[13px] leading-relaxed text-muted">
            1536-dimensional embeddings stored in Postgres pgvector for the
            knowledge corpus and curated entries. Required for live semantic
            search and Brain Suggest.
          </div>
          <div
            className={`mt-1 font-mono text-[11px] ${
              status.embeddingsConfigured ? "text-emerald" : "text-amber-200"
            }`}
          >
            {status.embeddingsConfigured
              ? "OPENAI_API_KEY is set."
              : "Set OPENAI_API_KEY on Vercel to enable live embeddings."}
          </div>
        </div>
      </Panel>
    </>
  );
}
