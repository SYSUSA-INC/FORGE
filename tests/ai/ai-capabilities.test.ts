/**
 * BL-AIX Phase 1f — the per-model capability table and the rule for
 * when a failed call may move to the fallback provider.
 */
import { describe, expect, it } from "vitest";
import { canServe, capabilitiesFor, clampMaxTokens, isFallbackEligible } from "@/lib/ai-capabilities";
import { ProviderHttpError } from "@/lib/ai";
import { DeadlineError } from "@/lib/http-retry";

describe("BL-AIX Phase 1f — model capabilities", () => {
  it("knows what each provider can do and each model's output ceiling", () => {
    expect(capabilitiesFor("anthropic", "claude-sonnet-4-6")).toEqual({ tools: true, documents: true, streaming: true, maxOutputTokens: 32_000 });
    expect(capabilitiesFor("anthropic", "claude-3-haiku-20240307").maxOutputTokens).toBe(4_096);
    expect(capabilitiesFor("anthropic", "claude-3-5-sonnet-20241022").maxOutputTokens).toBe(8_192);
    expect(capabilitiesFor("azure", "gpt-4o")).toEqual({ tools: true, documents: false, streaming: false, maxOutputTokens: 16_384 });
    expect(capabilitiesFor("azure", "gpt-4.1").maxOutputTokens).toBe(32_768);
    expect(capabilitiesFor("vllm", "llama")).toEqual({ tools: false, documents: false, streaming: false, maxOutputTokens: 8_192 });
    expect(capabilitiesFor("vllm", "llama", { VLLM_SUPPORTS_TOOLS: "1" }).tools).toBe(true);
    expect(capabilitiesFor("bedrock", "").tools).toBe(false);
    expect(capabilitiesFor("stub", "").documents).toBe(true);
  });

  it("takes an operator's output ceiling from env, ignoring nonsense", () => {
    expect(capabilitiesFor("azure", "gpt-4o", { AZURE_OPENAI_MAX_OUTPUT_TOKENS: "4096" }).maxOutputTokens).toBe(4_096);
    expect(capabilitiesFor("vllm", "m", { VLLM_MAX_OUTPUT_TOKENS: "16000" }).maxOutputTokens).toBe(16_000);
    expect(capabilitiesFor("vllm", "m", { VLLM_MAX_OUTPUT_TOKENS: "lots" }).maxOutputTokens).toBe(8_192);
    expect(capabilitiesFor("vllm", "m", { VLLM_MAX_OUTPUT_TOKENS: "10" }).maxOutputTokens).toBe(8_192);
  });

  it("clamps maxTokens to the ceiling and leaves an unset value unset", () => {
    const caps = capabilitiesFor("anthropic", "claude-3-haiku-20240307");
    expect(clampMaxTokens(8_000, caps)).toBe(4_096);
    expect(clampMaxTokens(1_200, caps)).toBe(1_200);
    expect(clampMaxTokens(undefined, caps)).toBeUndefined();
  });

  it("serves a request only when tools and documents are covered", () => {
    const azure = capabilitiesFor("azure", "gpt-4o");
    const vllm = capabilitiesFor("vllm", "m");
    expect(canServe(azure, { tool: true, documents: false })).toBe(true);
    expect(canServe(azure, { tool: false, documents: true })).toBe(false);
    expect(canServe(vllm, { tool: true, documents: false })).toBe(false);
    expect(canServe(vllm, { tool: false, documents: false })).toBe(true);
  });
});

describe("BL-AIX Phase 1f — fallback eligibility", () => {
  it("falls back on an outage, a missed deadline or a dropped connection", () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
      expect(isFallbackEligible(new ProviderHttpError(`Anthropic ${status}: x`, status))).toBe(true);
    }
    expect(isFallbackEligible(new DeadlineError("Anthropic", 150_000))).toBe(true);
    expect(isFallbackEligible(new TypeError("fetch failed"))).toBe(true);
    expect(isFallbackEligible(new Error("read ECONNRESET"))).toBe(true);
  });

  it("does not fall back on a bad request, a refused key or anything that is not an error", () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isFallbackEligible(new ProviderHttpError(`Anthropic ${status}: x`, status))).toBe(false);
    }
    expect(isFallbackEligible(new Error("Unexpected token in JSON"))).toBe(false);
    expect(isFallbackEligible("529")).toBe(false);
    expect(isFallbackEligible(null)).toBe(false);
  });
});
