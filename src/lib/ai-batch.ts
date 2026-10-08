/**
 * BL-AIX Phase 1g-2 — tenant calls through Anthropic's Message Batches
 * API: asynchronous, at half the token price, for work nobody waits on
 * (the nightly scout's triage).
 *
 * One batch carries one tenant's requests only. Each request passes the
 * same gate as a live call (routing, the trial and token-cap refusals,
 * the untrusted-content rule, the output ceiling), and each outcome gets
 * its own ai_call_log row (`batched`) and its own token metering when
 * the results are read. Anthropic only: other providers keep the live
 * path, and callers fall back to it whenever a submit fails.
 *
 * The HTTP layer is swappable for tests (`__setBatchTransportForTest`);
 * nothing here touches a tenant table.
 */
import "server-only";

import type { z } from "zod";
import {
  __buildAnthropicBody,
  __parseAnthropicResponse,
  getAIProviderStatus,
  refuseIfOverCap,
  tenantRoutedModel,
  logRepairs,
  validateStructured,
  type AICompleteOptions,
  type AICompleteResult,
  type AIStructuredValidation,
} from "@/lib/ai";
import { batchFailureText, batchingEnabled, isBatchCustomId, parseBatchResults, type BatchResultLine } from "@/lib/ai-batch-logic";
import { capabilitiesFor, clampMaxTokens } from "@/lib/ai-capabilities";
import type { AiFeature } from "@/lib/ai-features";
import { promptVersionFor } from "@/lib/ai-prompt-versions";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/ai-routing";
import { fetchWithRetry } from "@/lib/http-retry";
import { withUntrustedContentRule } from "@/lib/prompt-safety";

const API = "https://api.anthropic.com/v1/messages/batches";
const DEADLINE_MS = 60_000;

export type BatchTransport = {
  create(requests: { custom_id: string; params: Record<string, unknown> }[]): Promise<string>;
  retrieve(externalId: string): Promise<{ ended: boolean; resultsUrl: string | null }>;
  results(resultsUrl: string): Promise<string>;
};

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": (process.env.ANTHROPIC_API_KEY ?? "").trim(),
    "anthropic-version": "2023-06-01",
  };
}

async function ok(res: Response, label: string): Promise<Response> {
  if (!res.ok) throw new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

const httpTransport: BatchTransport = {
  async create(requests) {
    const res = await ok(
      await fetchWithRetry(API, { method: "POST", headers: headers(), body: JSON.stringify({ requests }) }, { label: "Anthropic batch", timeoutMs: DEADLINE_MS }),
      "Anthropic batch",
    );
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("Anthropic batch: the response carried no batch id.");
    return json.id;
  },
  async retrieve(externalId) {
    const res = await ok(
      await fetchWithRetry(`${API}/${encodeURIComponent(externalId)}`, { method: "GET", headers: headers() }, { label: "Anthropic batch", timeoutMs: DEADLINE_MS }),
      "Anthropic batch",
    );
    const json = (await res.json()) as { processing_status?: string; results_url?: string | null };
    return { ended: json.processing_status === "ended", resultsUrl: json.results_url ?? null };
  },
  async results(resultsUrl) {
    const res = await ok(
      await fetchWithRetry(resultsUrl, { method: "GET", headers: headers() }, { label: "Anthropic batch results", timeoutMs: DEADLINE_MS }),
      "Anthropic batch results",
    );
    return res.text();
  },
};

let transport: BatchTransport = httpTransport;
export function __setBatchTransportForTest(t: BatchTransport | null): void {
  transport = t ?? httpTransport;
}

/** Whether nightly work should go through a batch now (Anthropic active, not switched off). */
export function batchingAvailable(): boolean {
  const { active } = getAIProviderStatus();
  return active.configured && batchingEnabled(process.env, active.name);
}

export type BatchRequest = { customId: string; opts: AICompleteOptions };

/** What the collector needs to log a request's outcome like a live call. */
export type BatchRequestMeta = {
  customId: string;
  requestedModel: string;
  maxTokens: number | null;
  cacheSystem: boolean;
  hasDocuments: boolean;
};

/**
 * Submit one tenant's requests as a single batch. Throws when the tenant
 * may not call the AI now (trial ended, token cap reached) or the submit
 * fails; the caller then refunds and falls back as it sees fit.
 */
export async function submitTenantBatch(input: {
  organizationId: string;
  feature: AiFeature;
  promptVersion?: string;
  requests: BatchRequest[];
}): Promise<{ externalId: string; requests: BatchRequestMeta[] }> {
  if (input.requests.length === 0) throw new Error("A batch needs at least one request.");
  for (const r of input.requests) {
    if (!isBatchCustomId(r.customId)) throw new Error(`Batch custom id "${r.customId}" is not valid.`);
  }
  const { getCurrentTier } = await import("@/lib/subscription-gates");
  const { recordAiCall } = await import("@/lib/ai-telemetry");
  const tier = await getCurrentTier(input.organizationId);
  const promptVersion = input.promptVersion || promptVersionFor(input.feature);
  await refuseIfOverCap(input.organizationId, tier, (error) =>
    recordAiCall({ organizationId: input.organizationId, feature: input.feature, variant: "batch", promptVersion, status: "quota_refused", latencyMs: 0, error, batched: true }),
  );

  const metas: BatchRequestMeta[] = [];
  const wire = input.requests.map((r) => {
    const model = tenantRoutedModel(input.feature, tier, r.opts.model) ?? (process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL);
    const caps = capabilitiesFor("anthropic", model, process.env);
    const opts: AICompleteOptions = {
      ...r.opts,
      maxTokens: clampMaxTokens(r.opts.maxTokens, caps),
      // BL-AIX Phase 0d — quoted documents are data, never instructions.
      system: withUntrustedContentRule(r.opts.system),
      onDelta: undefined,
    };
    metas.push({
      customId: r.customId,
      requestedModel: model,
      maxTokens: r.opts.maxTokens ?? null,
      cacheSystem: r.opts.cacheSystem ?? false,
      hasDocuments: (r.opts.documents?.length ?? 0) > 0,
    });
    return { custom_id: r.customId, params: __buildAnthropicBody(opts, model) };
  });
  const externalId = await transport.create(wire);
  return { externalId, requests: metas };
}

/** Where a submitted batch stands. */
export async function batchStatus(externalId: string): Promise<{ ended: boolean; resultsUrl: string | null }> {
  return transport.retrieve(externalId);
}

/** The ended batch's outcomes, keyed by custom id. */
export async function batchResults(resultsUrl: string): Promise<Map<string, BatchResultLine>> {
  return new Map(parseBatchResults(await transport.results(resultsUrl)).map((l) => [l.customId, l]));
}

/**
 * Log one request's outcome like a live call (one `batched` ai_call_log
 * row, the token metering after success) and validate a structured
 * answer. Returns the validated data, or null with the reason.
 */
export async function recordBatchOutcome<T>(input: {
  organizationId: string;
  feature: AiFeature;
  promptVersion: string;
  meta: BatchRequestMeta;
  line: BatchResultLine | undefined;
  schema?: z.ZodType<T>;
}): Promise<{ result: AICompleteResult | null; validation: AIStructuredValidation<T> | null; error: string | null }> {
  const { recordAiCall } = await import("@/lib/ai-telemetry");
  const base = {
    organizationId: input.organizationId,
    feature: input.feature,
    variant: "batch",
    promptVersion: input.promptVersion,
    requestedModel: input.meta.requestedModel,
    maxTokens: input.meta.maxTokens,
    cacheSystem: input.meta.cacheSystem,
    hasDocuments: input.meta.hasDocuments,
    batched: true,
    // Queue time is not provider latency; batched rows stay out of the latency figures.
    latencyMs: 0,
  };
  if (input.line?.type !== "succeeded") {
    const error = batchFailureText(input.line);
    await recordAiCall({ ...base, status: "error", error });
    return { result: null, validation: null, error };
  }

  const parsed = __parseAnthropicResponse(input.line.message as Parameters<typeof __parseAnthropicResponse>[0], input.meta.requestedModel);
  const result: AICompleteResult = { ...parsed, provider: "anthropic", stubbed: false };
  const validation = input.schema ? validateStructured(input.schema, result) : null;
  await logRepairs(validation, { feature: input.feature, variant: "batch", model: result.model });
  await recordAiCall({
    ...base,
    status: "ok",
    provider: "anthropic",
    model: result.model,
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
    cacheReadTokens: result.cacheReadTokens ?? 0,
    cacheWriteTokens: result.cacheWriteTokens ?? 0,
    outputChars: result.text.length,
    viaTool: result.structured !== undefined,
    parseOk: validation ? validation.parseError === null : null,
    parseError: validation?.parseError ?? null,
  });

  // Post-record metering, as on the live path: informational when it
  // crosses the cap; the next live call is refused at the pre-check.
  const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
  if (tokens > 0) {
    const { enforceQuota } = await import("@/lib/subscription-gates");
    await enforceQuota(input.organizationId, "aiTokensPerMonth", tokens).catch(() => undefined);
  }
  return { result, validation, error: validation?.parseError ?? null };
}
