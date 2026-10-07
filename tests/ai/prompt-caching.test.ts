/**
 * BL-AIX Phase 1g — prompt caching on the wire and in the drafter's
 * layout: a message's cached prefix becomes its own Anthropic block with
 * a cache marker (at most four breakpoints per request), other providers
 * read it in front of the content, cache usage is parsed from both
 * response shapes, and every section of a proposal shares one prefix.
 */
import { describe, expect, it } from "vitest";
import {
  __applyAnthropicStreamEvent,
  __buildAnthropicBody,
  __buildOpenAiCompatBody,
  __newAnthropicStreamState,
  __parseAnthropicResponse,
  __parseOpenAiCompatResponse,
  messageText,
  type AICompleteOptions,
} from "@/lib/ai";
import { buildSectionDraftPrompt } from "@/lib/ai-prompts";
import { draftSnapshot } from "./prompt-fixtures";

const CACHE = { type: "ephemeral" };

function anthropicMessages(opts: AICompleteOptions) {
  return __buildAnthropicBody(opts, "claude-test").messages as { role: string; content: unknown }[];
}

describe("BL-AIX Phase 1g — cached prefixes on the wire", () => {
  it("sends a cached prefix as its own marked block ahead of the content", () => {
    const [m] = anthropicMessages({ system: "s", messages: [{ role: "user", cachedPrefix: "Shared RFP context", content: "Draft section 3." }] });
    expect(m!.content).toEqual([
      { type: "text", text: "Shared RFP context", cache_control: CACHE },
      { type: "text", text: "Draft section 3." },
    ]);
  });

  it("leaves a message without a prefix as plain text", () => {
    const [m] = anthropicMessages({ system: "s", messages: [{ role: "user", content: "Hello" }] });
    expect(m!.content).toBe("Hello");
  });

  it("puts attached documents first, then the prefix, then the content", () => {
    const [m] = anthropicMessages({
      system: "s",
      documents: [{ name: "rfp.pdf", mediaType: "application/pdf", bytes: new Uint8Array([1]) }],
      messages: [{ role: "user", cachedPrefix: "Shared", content: "Ask" }],
    });
    const blocks = m!.content as { type: string; text?: string; cache_control?: unknown }[];
    expect(blocks.map((b) => b.type)).toEqual(["document", "text", "text"]);
    expect(blocks[1]).toEqual({ type: "text", text: "Shared", cache_control: CACHE });
  });

  it("never sends an empty text block after a prefix", () => {
    const [m] = anthropicMessages({ system: "s", messages: [{ role: "user", cachedPrefix: "Shared", content: "" }] });
    expect(m!.content).toEqual([{ type: "text", text: "Shared", cache_control: CACHE }]);
  });

  it("keeps to four breakpoints, giving the latest prefixes theirs", () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", cachedPrefix: `p${i}`, content: `c${i}` }));
    const sent = anthropicMessages({ system: "s", cacheSystem: true, messages });
    const marked = sent.map((m) => (m.content as { cache_control?: unknown }[]).some((b) => b.cache_control !== undefined));
    expect(marked).toEqual([false, false, true, true, true]);
  });

  it("gives other providers the prefix in front of the content", () => {
    const body = __buildOpenAiCompatBody({ system: "s", messages: [{ role: "user", cachedPrefix: "Shared", content: "Ask" }] }, false);
    expect(body.messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "Shared\n\nAsk" },
    ]);
    expect(messageText({ role: "user", content: "Ask" })).toBe("Ask");
  });
});

describe("BL-AIX Phase 1g — cache usage", () => {
  it("counts every prompt token as input and records the cached part (Anthropic)", () => {
    const res = __parseAnthropicResponse(
      { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 0 } },
      "m",
    );
    expect(res).toMatchObject({ inputTokens: 9_200, outputTokens: 50, cacheReadTokens: 9_000 });
    expect(res.cacheWriteTokens).toBeUndefined();

    const plain = __parseAnthropicResponse({ content: [], usage: { input_tokens: 12, output_tokens: 3 } }, "m");
    expect(plain.inputTokens).toBe(12);
    expect(plain.cacheReadTokens).toBeUndefined();
  });

  it("reads cache usage from a streamed answer's first event", () => {
    const state = __newAnthropicStreamState("m");
    __applyAnthropicStreamEvent(state, { type: "message_start", message: { usage: { input_tokens: 100, cache_creation_input_tokens: 4_000 } } });
    expect(state).toMatchObject({ inputTokens: 4_100, cacheWriteTokens: 4_000 });
  });

  it("records OpenAI-compatible cached tokens, already inside prompt_tokens", () => {
    const res = __parseOpenAiCompatResponse(
      { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3_000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 2_048 } } },
      "gpt",
    );
    expect(res).toMatchObject({ inputTokens: 3_000, cacheReadTokens: 2_048 });
  });
});

describe("BL-AIX Phase 1g — the drafter's shared prefix", () => {
  it("is the same for every section and mode of a proposal, and holds only proposal-wide context", () => {
    const technical = buildSectionDraftPrompt("draft", draftSnapshot).messages[0]!;
    const management = buildSectionDraftPrompt("improve", {
      ...draftSnapshot,
      section: { ...draftSnapshot.section, title: "Management Approach", kind: "management" },
      solicitation: { ...draftSnapshot.solicitation!, mappedRequirements: [{ number: "L.5.3", text: "Describe staffing.", category: "section_l" }] },
      sources: [],
      customerVoice: undefined,
      authorVoice: undefined,
    }).messages[0]!;

    expect(technical.cachedPrefix).toBeTruthy();
    expect(management.cachedPrefix).toBe(technical.cachedPrefix);
    expect(technical.cachedPrefix).toContain("Zero downtime");
    expect(technical.cachedPrefix).toContain("All extracted requirements");
    expect(technical.cachedPrefix).not.toContain("Technical Approach");
    expect(technical.cachedPrefix).not.toContain("Mode:");

    expect(technical.content).toContain("Mode: draft.");
    expect(technical.content).toContain("[L.5.2.1] (section_l) Describe the migration approach.");
    expect(management.content).toContain("[L.5.3] (section_l) Describe staffing.");
    expect(management.content).toContain("Management Approach");
  });

  it("sends no prefix when there are no win themes and no solicitation", () => {
    const [m] = buildSectionDraftPrompt("draft", { ...draftSnapshot, solicitation: undefined, winThemes: [] }).messages;
    expect(m!.cachedPrefix).toBeUndefined();
    expect(m!.content.startsWith("Mode: draft.")).toBe(true);
  });
});
