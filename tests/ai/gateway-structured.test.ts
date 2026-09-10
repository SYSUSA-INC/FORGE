/**
 * BL-AI-TOOLS — runtime tests for structured output through the gateway.
 *
 * Two layers:
 *   1. Pure wire-format checks: the Anthropic and OpenAI-compatible
 *      request builders emit a forced single tool, and the response
 *      parsers lift the tool payload into `structured`.
 *   2. Gateway behaviour through the test seam: `completeStructuredForTenant`
 *      validates the tool payload, falls back to JSON-in-text when no tool
 *      call comes back, reports validation failures without throwing, and
 *      records via_tool / parse_ok on the same ai_call_log row as the call.
 *
 * Same fixture pattern as gateway-tokens.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiCallLogs } from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";
import {
  __buildAnthropicBody,
  __buildOpenAiCompatBody,
  __parseAnthropicResponse,
  __parseOpenAiCompatResponse,
  __setCompleteImplForTest,
  completeStructuredForTenant,
  validateStructured,
  zodToToolSchema,
  type AICompleteOptions,
  type AICompleteResult,
} from "@/lib/ai";

const verdictSchema = z.object({
  verdict: z.enum(["go", "no_go"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).max(3),
  note: z.string().nullable().optional(),
});

function logsFor(organizationId: string) {
  return db
    .select()
    .from(aiCallLogs)
    .where(eq(aiCallLogs.organizationId, organizationId))
    .orderBy(asc(aiCallLogs.createdAt));
}

// ── Layer 1: wire format (no DB, no network) ──────────────────────────

describe("BL-AI-TOOLS — schema + wire format", () => {
  it("zodToToolSchema emits an object-rooted JSON Schema without $schema", () => {
    const json = zodToToolSchema(verdictSchema);
    expect(json.type).toBe("object");
    expect(json.$schema).toBeUndefined();
    const props = json.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(
      ["confidence", "note", "reasons", "verdict"].sort(),
    );
    expect(json.required).toEqual(
      expect.arrayContaining(["verdict", "confidence", "reasons"]),
    );
    expect((json.required as string[]).includes("note")).toBe(false);
  });

  it("zodToToolSchema refuses non-object roots", () => {
    expect(() => zodToToolSchema(z.array(z.string()))).toThrow(/object at the root/);
  });

  it("Anthropic body carries a single forced tool with the schema", () => {
    const opts: AICompleteOptions = {
      system: "sys",
      cacheSystem: true,
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 500,
      tool: {
        name: "record_verdict",
        description: "Record it",
        inputSchema: zodToToolSchema(verdictSchema),
      },
    };
    const body = __buildAnthropicBody(opts, "test-model");
    const tools = body.tools as { name: string; input_schema: { type: string } }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("record_verdict");
    expect(tools[0]!.input_schema.type).toBe("object");
    expect(body.tool_choice).toEqual({
      type: "tool",
      name: "record_verdict",
      disable_parallel_tool_use: true,
    });
    // System prompt caching still intact alongside tools.
    expect(Array.isArray(body.system)).toBe(true);
  });

  it("Anthropic body omits tools when no tool is requested", () => {
    const body = __buildAnthropicBody(
      { messages: [{ role: "user", content: "hi" }] },
      "m",
    );
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("Anthropic response parser lifts tool_use input into structured", () => {
    const parsed = __parseAnthropicResponse(
      {
        content: [
          { type: "text", text: "Recording." },
          { type: "tool_use", name: "record_verdict", input: { verdict: "go" } },
        ],
        usage: { input_tokens: 11, output_tokens: 7 },
        model: "m-1",
        stop_reason: "tool_use",
      },
      "fallback",
    );
    expect(parsed.structured).toEqual({ verdict: "go" });
    expect(parsed.text).toBe("Recording.");
    expect(parsed.model).toBe("m-1");
    expect(parsed.inputTokens).toBe(11);
    expect(parsed.outputTokens).toBe(7);
    expect(parsed.stopReason).toBe("tool_use");
  });

  it("OpenAI-compatible body carries a forced function only when tools are enabled", () => {
    const opts: AICompleteOptions = {
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tool: { name: "record_verdict", inputSchema: zodToToolSchema(verdictSchema) },
    };
    const withTools = __buildOpenAiCompatBody(opts, true, "llama");
    expect(withTools.model).toBe("llama");
    expect(withTools.tool_choice).toEqual({
      type: "function",
      function: { name: "record_verdict" },
    });
    const fn = (withTools.tools as { function: { name: string; parameters: { type: string } } }[])[0]!;
    expect(fn.function.name).toBe("record_verdict");
    expect(fn.function.parameters.type).toBe("object");

    const withoutTools = __buildOpenAiCompatBody(opts, false);
    expect(withoutTools.tools).toBeUndefined();
    expect(withoutTools.tool_choice).toBeUndefined();
    expect(withoutTools.model).toBeUndefined();
  });

  it("OpenAI-compatible response parser decodes tool_call arguments and tolerates bad JSON", () => {
    const good = __parseOpenAiCompatResponse(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ function: { name: "f", arguments: '{"verdict":"no_go"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      },
      "dep",
    );
    expect(good.structured).toEqual({ verdict: "no_go" });
    expect(good.text).toBe("");
    expect(good.model).toBe("dep");

    const bad = __parseOpenAiCompatResponse(
      {
        choices: [
          { message: { content: "fallback text", tool_calls: [{ function: { arguments: "{not json" } }] } },
        ],
      },
      "dep",
    );
    expect(bad.structured).toBeUndefined();
    expect(bad.text).toBe("fallback text");
  });

  it("validateStructured prefers the tool payload and falls back to JSON in text", () => {
    const base: AICompleteResult = {
      text: "",
      provider: "stub",
      model: "m",
      stubbed: false,
    };
    const viaTool = validateStructured(verdictSchema, {
      ...base,
      structured: { verdict: "go", confidence: 0.8, reasons: ["a"] },
    });
    expect(viaTool.viaTool).toBe(true);
    expect(viaTool.parseError).toBeNull();
    expect(viaTool.data?.verdict).toBe("go");

    const viaText = validateStructured(verdictSchema, {
      ...base,
      text: 'Sure! Here it is:\n```json\n{"verdict":"no_go","confidence":0.2,"reasons":[]}\n```',
    });
    expect(viaText.viaTool).toBe(false);
    expect(viaText.parseError).toBeNull();
    expect(viaText.data?.verdict).toBe("no_go");

    const invalid = validateStructured(verdictSchema, {
      ...base,
      structured: { verdict: "maybe", confidence: 2, reasons: [] },
    });
    expect(invalid.data).toBeNull();
    expect(invalid.parseError).toMatch(/verdict/);

    const notJson = validateStructured(verdictSchema, { ...base, text: "no braces here" });
    expect(notJson.data).toBeNull();
    expect(notJson.parseError).toMatch(/not valid JSON/);
  });
});

// ── Layer 2: gateway through the seam, with telemetry ─────────────────

let seenOpts: AICompleteOptions | null = null;
let nextResult: Partial<AICompleteResult> = {};

describe("BL-AI-TOOLS — completeStructuredForTenant (runtime)", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("ai-structured");
    seenOpts = null;
    nextResult = {};
    __setCompleteImplForTest(async (opts) => {
      seenOpts = opts;
      return {
        text: "",
        provider: "stub" as const,
        model: "test-mock",
        inputTokens: 5,
        outputTokens: 9,
        stubbed: false,
        ...nextResult,
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await fx.cleanup();
  });

  it("passes a forced tool to the provider and returns validated data; row has via_tool + parse_ok", async () => {
    nextResult = {
      structured: { verdict: "go", confidence: 0.9, reasons: ["strong fit"] },
    };
    const res = await completeStructuredForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "winner_analysis",
      schema: verdictSchema,
      toolName: "record_verdict",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });

    expect(seenOpts?.tool?.name).toBe("record_verdict");
    expect((seenOpts?.tool?.inputSchema as { type: string }).type).toBe("object");
    expect(res.viaTool).toBe(true);
    expect(res.parseError).toBeNull();
    expect(res.data?.verdict).toBe("go");
    expect(res.data?.reasons).toEqual(["strong fit"]);

    const rows = await logsFor(fx.orgA.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ok");
    expect(rows[0]!.viaTool).toBe(true);
    expect(rows[0]!.parseOk).toBe(true);
    expect(rows[0]!.parseError).toBeNull();
  });

  it("derives the tool name from the feature when none is given", async () => {
    nextResult = { structured: { verdict: "go", confidence: 1, reasons: [] } };
    await completeStructuredForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "knowledge_classify",
      schema: verdictSchema,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.tool?.name).toBe("knowledge_classify_result");
  });

  it("falls back to JSON-in-text when the provider returns no tool call", async () => {
    nextResult = {
      text: 'Here you go: {"verdict":"no_go","confidence":0.3,"reasons":["weak"]} — done.',
    };
    const res = await completeStructuredForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_chat",
      schema: verdictSchema,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(res.viaTool).toBe(false);
    expect(res.data?.verdict).toBe("no_go");

    const rows = await logsFor(fx.orgA.organizationId);
    expect(rows[0]!.viaTool).toBe(false);
    expect(rows[0]!.parseOk).toBe(true);
  });

  it("returns data=null with a parseError (no throw) and records parse_ok=false", async () => {
    nextResult = { structured: { verdict: "maybe", confidence: 5, reasons: [] } };
    const res = await completeStructuredForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "proposal_scan",
      schema: verdictSchema,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(res.data).toBeNull();
    expect(res.parseError).toMatch(/expected shape/);
    expect(res.viaTool).toBe(true);

    const rows = await logsFor(fx.orgA.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ok");
    expect(rows[0]!.parseOk).toBe(false);
    expect(rows[0]!.parseError).toMatch(/verdict|confidence/);
  });

  it("stub responses are not counted as parse failures (parse_ok stays null)", async () => {
    nextResult = { text: "FORGE AI is currently running in stub mode.", stubbed: true };
    const res = await completeStructuredForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "ebuy_extract",
      schema: verdictSchema,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(res.stubbed).toBe(true);
    expect(res.data).toBeNull();

    const rows = await logsFor(fx.orgA.organizationId);
    expect(rows[0]!.stubbed).toBe(true);
    expect(rows[0]!.parseOk).toBeNull();
  });

  it("free-text completeForTenant rows keep parse_ok null and via_tool false", async () => {
    const { completeForTenant } = await import("@/lib/ai");
    nextResult = { text: "plain prose" };
    await completeForTenant({
      organizationId: fx.orgB.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.tool).toBeUndefined();
    const rows = await logsFor(fx.orgB.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.viaTool).toBe(false);
    expect(rows[0]!.parseOk).toBeNull();
  });
});
