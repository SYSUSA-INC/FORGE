/**
 * BL-AI-STREAMING — runtime tests for streaming through the gateway.
 *
 * Layer 1 (pure): the SSE parser handles chunk boundaries, multi-line
 * data and trailing blocks; the Anthropic stream reducer accumulates
 * text, usage and stop reason and forwards deltas.
 *
 * Layer 2 (gateway through the seam): `onDelta` reaches the provider,
 * a provider that does not stream still triggers one full-text delta,
 * and telemetry records the aggregate exactly once. The stub provider
 * streams its whole text in one delta.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiCallLogs } from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";
import {
  __applyAnthropicStreamEvent,
  __newAnthropicStreamState,
  __setCompleteImplForTest,
  complete,
  completeForTenant,
  type AICompleteOptions,
} from "@/lib/ai";
import { createSseParser, encodeSseEvent, readSseStream } from "@/lib/sse";

// ── Layer 1: pure ─────────────────────────────────────────────────────

describe("BL-AI-STREAMING — SSE parser", () => {
  it("splits complete blocks and carries a partial block across pushes", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"a":')).toEqual(['{"a":1}']);
    expect(p.push('2}\n\n')).toEqual(['{"a":2}']);
    expect(p.flush()).toEqual([]);
  });

  it("joins multi-line data, ignores event/id/comment lines, handles CRLF", () => {
    const p = createSseParser();
    const out = p.push(
      'event: message\r\nid: 7\r\n: comment\r\ndata: {"x":\r\ndata: 1}\r\n\r\n',
    );
    expect(out).toEqual(['{"x":\n1}']);
  });

  it("flush returns a trailing block that never got its blank line", () => {
    const p = createSseParser();
    expect(p.push('data: {"tail":true}')).toEqual([]);
    expect(p.flush()).toEqual(['{"tail":true}']);
  });

  it("encodeSseEvent round-trips through readSseStream", async () => {
    const events = [{ type: "delta", text: "a" }, { type: "done", reply: "a" }];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of events) controller.enqueue(encodeSseEvent(e));
        // OpenAI-style sentinel must be skipped, not thrown.
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const res = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
    const seen: unknown[] = [];
    await readSseStream(res, (ev) => seen.push(ev));
    expect(seen).toEqual(events);
  });
});

describe("BL-AI-STREAMING — Anthropic stream reducer", () => {
  it("accumulates text, usage, model and stop reason; forwards deltas", () => {
    const state = __newAnthropicStreamState("fallback-model");
    const deltas: string[] = [];
    const on = (t: string) => deltas.push(t);

    __applyAnthropicStreamEvent(
      state,
      { type: "message_start", message: { model: "m-live", usage: { input_tokens: 12, output_tokens: 1 } } },
      on,
    );
    __applyAnthropicStreamEvent(state, { type: "content_block_start" }, on);
    __applyAnthropicStreamEvent(
      state,
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
      on,
    );
    __applyAnthropicStreamEvent(state, { type: "ping" }, on);
    __applyAnthropicStreamEvent(
      state,
      { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
      on,
    );
    __applyAnthropicStreamEvent(state, { type: "content_block_stop" }, on);
    __applyAnthropicStreamEvent(
      state,
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
      on,
    );
    __applyAnthropicStreamEvent(state, { type: "message_stop" }, on);

    expect(state.text).toBe("Hello world");
    expect(deltas).toEqual(["Hello", " world"]);
    expect(state.model).toBe("m-live");
    expect(state.inputTokens).toBe(12);
    expect(state.outputTokens).toBe(7);
    expect(state.stopReason).toBe("end_turn");
  });

  it("throws on an error event", () => {
    const state = __newAnthropicStreamState("m");
    expect(() =>
      __applyAnthropicStreamEvent(state, {
        type: "error",
        error: { type: "overloaded_error", message: "Overloaded" },
      }),
    ).toThrow(/overloaded_error: Overloaded/);
  });
});

// ── Layer 2: gateway ──────────────────────────────────────────────────

let seenOpts: AICompleteOptions | null = null;
let providerStreams = true;

describe("BL-AI-STREAMING — gateway onDelta (runtime)", () => {
  let fx: TwoTenantFixture;
  const savedProvider = process.env.AI_PROVIDER;

  beforeEach(async () => {
    fx = await createTwoTenants("ai-streaming");
    seenOpts = null;
    providerStreams = true;
    __setCompleteImplForTest(async (opts) => {
      seenOpts = opts;
      if (providerStreams && opts.onDelta) {
        opts.onDelta("Hel");
        opts.onDelta("lo");
        return {
          text: "Hello",
          provider: "anthropic" as const,
          model: "m",
          inputTokens: 3,
          outputTokens: 2,
          stubbed: false,
          streamed: true,
        };
      }
      return {
        text: "Whole answer",
        provider: "azure" as const,
        model: "dep",
        inputTokens: 3,
        outputTokens: 4,
        stubbed: false,
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    if (savedProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = savedProvider;
    await fx.cleanup();
  });

  it("forwards onDelta to the provider and returns the aggregate; one telemetry row", async () => {
    const deltas: string[] = [];
    const res = await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
      onDelta: (t) => deltas.push(t),
    });
    expect(typeof seenOpts?.onDelta).toBe("function");
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(res.text).toBe("Hello");
    expect(res.streamed).toBe(true);

    const rows = await db
      .select()
      .from(aiCallLogs)
      .where(eq(aiCallLogs.organizationId, fx.orgA.organizationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ok");
    expect(rows[0]!.outputChars).toBe(5);
    expect(rows[0]!.inputTokens).toBe(3);
    expect(rows[0]!.outputTokens).toBe(2);
  });

  it("a provider that does not stream still yields one full-text delta", async () => {
    providerStreams = false;
    const deltas: string[] = [];
    const res = await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_chat",
      system: "x",
      messages: [{ role: "user", content: "y" }],
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas).toEqual(["Whole answer"]);
    expect(res.text).toBe("Whole answer");
    expect(res.streamed).toBeUndefined();
  });

  it("a throwing onDelta consumer does not fail the call", async () => {
    providerStreams = false;
    const res = await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_chat",
      system: "x",
      messages: [{ role: "user", content: "y" }],
      onDelta: () => {
        throw new Error("consumer blew up");
      },
    });
    expect(res.text).toBe("Whole answer");
  });

  it("the stub provider streams its text as a single delta", async () => {
    __setCompleteImplForTest(null);
    process.env.AI_PROVIDER = "stub";
    const deltas: string[] = [];
    const res = await complete({
      messages: [{ role: "user", content: "hi" }],
      onDelta: (t) => deltas.push(t),
    });
    expect(res.stubbed).toBe(true);
    expect(res.streamed).toBe(true);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBe(res.text);
  });
});
