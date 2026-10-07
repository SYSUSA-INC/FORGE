/**
 * BL-AIX Phase 1g-2 — reading a Message Batch: the results file, the
 * custom-id rule, when a batch is given up on, and when batching applies.
 */
import { describe, expect, it } from "vitest";
import {
  BATCH_GIVE_UP_MS,
  batchErrorText,
  batchFailureText,
  batchGivenUp,
  batchingEnabled,
  isBatchCustomId,
  parseBatchResults,
} from "@/lib/ai-batch-logic";

describe("BL-AIX Phase 1g-2 — batch results", () => {
  it("reads every outcome type, keyed by custom id, skipping blank and malformed lines", () => {
    const jsonl = [
      JSON.stringify({ custom_id: "a", result: { type: "succeeded", message: { content: [{ type: "text", text: "ok" }] } } }),
      "",
      "{not json",
      JSON.stringify({ custom_id: "b", result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: "max_tokens too large" } } } }),
      JSON.stringify({ custom_id: "c", result: { type: "expired" } }),
      JSON.stringify({ custom_id: "d", result: { type: "canceled" } }),
      JSON.stringify({ custom_id: "e", result: { type: "mystery" } }),
      JSON.stringify({ result: { type: "succeeded" } }),
    ].join("\n");
    const lines = parseBatchResults(jsonl);
    expect(lines.map((l) => [l.customId, l.type])).toEqual([
      ["a", "succeeded"],
      ["b", "errored"],
      ["c", "expired"],
      ["d", "canceled"],
      ["e", "errored"],
    ]);
    expect(lines[1]).toMatchObject({ error: "invalid_request_error: max_tokens too large" });
    expect(lines[4]).toMatchObject({ error: "Unknown result type mystery." });
  });

  it("says why a request produced nothing", () => {
    expect(batchFailureText(undefined)).toBe("Missing from the batch results.");
    expect(batchFailureText({ customId: "c", type: "expired" })).toMatch(/expired/);
    expect(batchFailureText({ customId: "d", type: "canceled" })).toMatch(/canceled/);
    expect(batchErrorText({ type: "overloaded_error", message: "busy" })).toBe("overloaded_error: busy");
    expect(batchErrorText(null)).toMatch(/provider reported an error/);
  });

  it("accepts row uuids as custom ids and refuses anything else", () => {
    expect(isBatchCustomId("3f2b8c1e-9d4a-4c7b-8e2f-1a2b3c4d5e6f")).toBe(true);
    expect(isBatchCustomId("has space")).toBe(false);
    expect(isBatchCustomId("")).toBe(false);
    expect(isBatchCustomId("x".repeat(65))).toBe(false);
  });

  it("gives a batch up 26 hours after submission", () => {
    const submitted = new Date("2026-10-07T00:00:00Z");
    expect(batchGivenUp(submitted, new Date(submitted.getTime() + BATCH_GIVE_UP_MS - 1))).toBe(false);
    expect(batchGivenUp(submitted, new Date(submitted.getTime() + BATCH_GIVE_UP_MS + 1))).toBe(true);
  });

  it("batches on Anthropic unless switched off", () => {
    expect(batchingEnabled({}, "anthropic")).toBe(true);
    expect(batchingEnabled({ AI_BATCH_NIGHTLY: "off" }, "anthropic")).toBe(false);
    expect(batchingEnabled({ AI_BATCH_NIGHTLY: " OFF " }, "anthropic")).toBe(false);
    expect(batchingEnabled({}, "azure")).toBe(false);
    expect(batchingEnabled({}, "stub")).toBe(false);
  });
});
