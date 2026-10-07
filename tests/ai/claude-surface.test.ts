/**
 * BL-AIX Phase 1i — the gateway speaks to each Claude generation in the
 * shape it accepts: no forced tool choice on Opus 5.5 / Sonnet 5.5 /
 * Fable 5.1, no temperature from Opus 4.7 / Sonnet 5, room in max_tokens
 * for models that think by default, and today's shape for today's models.
 */
import { describe, expect, it } from "vitest";
import { __buildAnthropicBody, assertAnswered, type AICompleteOptions, type AICompleteResult } from "@/lib/ai";
import { claudeSurface, claudeVersion, thinkingEffort, thinkingMaxTokens } from "@/lib/ai-capabilities";

const TOOL = { name: "record_scout_triage", description: "Record it.", inputSchema: { type: "object", properties: {} } };
const opts = (extra: Partial<AICompleteOptions> = {}): AICompleteOptions => ({
  system: "You triage opportunities.",
  messages: [{ role: "user", content: "Triage this." }],
  maxTokens: 600,
  temperature: 0.2,
  cacheSystem: true,
  ...extra,
});

describe("BL-AIX Phase 1i — Claude generations", () => {
  it("reads the family and version from current, dated, Bedrock and legacy ids", () => {
    expect(claudeVersion("claude-opus-5-5")).toEqual({ family: "opus", version: 5.5 });
    expect(claudeVersion("claude-haiku-4-5-20251001")).toEqual({ family: "haiku", version: 4.5 });
    expect(claudeVersion("anthropic.claude-sonnet-4-6")).toEqual({ family: "sonnet", version: 4.6 });
    expect(claudeVersion("claude-sonnet-4-20250514")).toEqual({ family: "sonnet", version: 4 });
    expect(claudeVersion("claude-opus-5")).toEqual({ family: "opus", version: 5 });
    expect(claudeVersion("claude-fable-5-1")).toEqual({ family: "fable", version: 5.1 });
    expect(claudeVersion("claude-3-5-sonnet-20241022")).toEqual({ family: "sonnet", version: 3.5 });
    expect(claudeVersion("my-own-model")).toBeNull();
  });

  it("knows which generation accepts forced tools, temperature and thinks by default", () => {
    const legacy = { forcedToolChoice: true, sampling: true, thinksByDefault: false };
    expect(claudeSurface("claude-sonnet-4-6")).toEqual(legacy);
    expect(claudeSurface("claude-haiku-4-5-20251001")).toEqual(legacy);
    expect(claudeSurface("my-own-model")).toEqual(legacy);
    expect(claudeSurface("claude-opus-4-7")).toEqual({ forcedToolChoice: true, sampling: false, thinksByDefault: false });
    expect(claudeSurface("claude-opus-5")).toEqual({ forcedToolChoice: true, sampling: false, thinksByDefault: true });
    expect(claudeSurface("claude-sonnet-5")).toEqual({ forcedToolChoice: true, sampling: false, thinksByDefault: true });
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]) {
      expect(claudeSurface(m), m).toEqual({ forcedToolChoice: false, sampling: false, thinksByDefault: true });
    }
  });

  it("gives thinking room in max_tokens and low effort to short or structured calls", () => {
    expect(thinkingMaxTokens(600, 32_000)).toBe(4_696);
    expect(thinkingMaxTokens(8_000, 32_000)).toBe(16_000);
    expect(thinkingMaxTokens(20_000, 32_000)).toBe(32_000);
    expect(thinkingEffort({ tool: true, maxTokens: 4_000 })).toBe("low");
    expect(thinkingEffort({ tool: false, maxTokens: 1_200 })).toBe("low");
    expect(thinkingEffort({ tool: false, maxTokens: 2_200 })).toBeUndefined();
  });
});

describe("BL-AIX Phase 1i — the request each generation receives", () => {
  it("keeps today's shape for today's models", () => {
    const body = __buildAnthropicBody(opts({ tool: TOOL }), "claude-sonnet-4-6");
    expect(body).toMatchObject({ max_tokens: 600, temperature: 0.2, tool_choice: { type: "tool", name: "record_scout_triage", disable_parallel_tool_use: true } });
    expect(body.output_config).toBeUndefined();
    expect((body.system as { text: string }[])[0]!.text).toBe("You triage opportunities.");
  });

  it("asks a newer model for the tool in the prompt, drops temperature and makes room to think", () => {
    const body = __buildAnthropicBody(opts({ tool: TOOL }), "claude-opus-5-5");
    expect(body.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(4_696);
    expect(body.output_config).toEqual({ effort: "low" });
    const system = (body.system as { text: string; cache_control?: unknown }[])[0]!;
    expect(system.text).toBe("You triage opportunities.\n\nAnswer by calling the record_scout_triage tool exactly once. Do not answer in prose.");
    expect(system.cache_control).toEqual({ type: "ephemeral" });
  });

  it("keeps forced tools on Opus 5 but leaves out its temperature, and lets long prose think at default effort", () => {
    const structured = __buildAnthropicBody(opts({ tool: TOOL }), "claude-opus-5");
    expect(structured.tool_choice).toMatchObject({ type: "tool" });
    expect(structured.temperature).toBeUndefined();
    const prose = __buildAnthropicBody(opts({ maxTokens: 2_200 }), "claude-sonnet-5-5");
    expect(prose.output_config).toBeUndefined();
    expect(prose.max_tokens).toBe(6_296);
    expect((prose.system as { text: string }[])[0]!.text).toBe("You triage opportunities.");
  });

  it("turns an empty refusal into an error and lets anything with an answer through", () => {
    const base: AICompleteResult = { text: "", provider: "anthropic", model: "m", stubbed: false, stopReason: "refusal" };
    expect(() => assertAnswered(base)).toThrow("declined");
    expect(assertAnswered({ ...base, text: "Partial answer." }).text).toBe("Partial answer.");
    expect(assertAnswered({ ...base, stopReason: "end_turn" })).toMatchObject({ stopReason: "end_turn" });
  });
});
