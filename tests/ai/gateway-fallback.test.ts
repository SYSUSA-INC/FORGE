/**
 * BL-AIX Phase 1f — provider fallback through the gateway.
 *
 * Layer 1 (no DB): which provider counts as the fallback.
 *
 * Layer 2 (gateway through the seam, against Postgres): an outage on the
 * active provider moves the call once to AI_FALLBACK_PROVIDER, on that
 * provider's own model and output ceiling, and leaves an error row plus
 * the answering row in ai_call_log. A bad request, a request with
 * documents the fallback cannot read, text already streamed to the user
 * or no configured fallback all leave the original error standing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiCallLogs } from "@/db/schema";
import {
  __setCompleteImplForTest,
  completeForTenant,
  getAIProviderStatus,
  ProviderHttpError,
  type AICompleteOptions,
} from "@/lib/ai";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const ENV_KEYS = [
  "AI_PROVIDER",
  "AI_FALLBACK_PROVIDER",
  "AI_MODEL_ROUTING",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_MODEL_FAST",
  "ANTHROPIC_MODEL_STRONG",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_MAX_OUTPUT_TOKENS",
  "VLLM_BASE_URL",
] as const;

let savedEnv: Record<string, string | undefined> = {};

function snapshotEnv() {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

/** Anthropic active with an Azure fallback; the seam keeps every key unused. */
function anthropicWithAzureFallback() {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-key-not-used";
  process.env.AI_FALLBACK_PROVIDER = "azure";
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.invalid";
  process.env.AZURE_OPENAI_API_KEY = "test-key-not-used";
  process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-4o";
}

describe("BL-AIX Phase 1f — which provider is the fallback", () => {
  beforeEach(() => {
    snapshotEnv();
    anthropicWithAzureFallback();
  });
  afterEach(restoreEnv);

  it("is the configured AI_FALLBACK_PROVIDER when it differs from the active one", () => {
    expect(getAIProviderStatus().fallback?.name).toBe("azure");
  });

  it("is none when unset, unconfigured, the same as the active provider, Bedrock, or in stub mode", () => {
    delete process.env.AI_FALLBACK_PROVIDER;
    expect(getAIProviderStatus().fallback).toBeNull();

    process.env.AI_FALLBACK_PROVIDER = "vllm";
    expect(getAIProviderStatus().fallback).toBeNull();

    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    expect(getAIProviderStatus().fallback).toBeNull();

    process.env.AI_FALLBACK_PROVIDER = "bedrock";
    expect(getAIProviderStatus().fallback).toBeNull();

    process.env.AI_FALLBACK_PROVIDER = "azure";
    process.env.AI_PROVIDER = "stub";
    expect(getAIProviderStatus().fallback).toBeNull();
  });
});

type Call = { opts: AICompleteOptions; target: string };

describe("BL-AIX Phase 1f — gateway fallback (runtime)", () => {
  let fx: TwoTenantFixture;
  let calls: Call[] = [];
  let primaryError: unknown = null;
  let fallbackError: unknown = null;
  let streamBeforeFailing = false;

  beforeEach(async () => {
    snapshotEnv();
    anthropicWithAzureFallback();
    fx = await createTwoTenants("ai-fallback");
    calls = [];
    primaryError = new ProviderHttpError("Anthropic 529: overloaded", 529);
    fallbackError = null;
    streamBeforeFailing = false;
    __setCompleteImplForTest(async (opts, target = "primary") => {
      calls.push({ opts, target });
      if (target === "primary") {
        if (streamBeforeFailing) opts.onDelta?.("partial ");
        if (primaryError) throw primaryError;
        return { text: "from anthropic", provider: "anthropic" as const, model: opts.model ?? "claude", inputTokens: 1, outputTokens: 1, stubbed: false };
      }
      if (fallbackError) throw fallbackError;
      return { text: "from azure", provider: "azure" as const, model: "gpt-4o", inputTokens: 2, outputTokens: 3, stubbed: false };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await fx.cleanup();
    restoreEnv();
  });

  async function rows() {
    return db.select().from(aiCallLogs).where(eq(aiCallLogs.organizationId, fx.orgA.organizationId)).orderBy(asc(aiCallLogs.createdAt));
  }

  function call(extra: Partial<AICompleteOptions> = {}) {
    return completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
      ...extra,
    });
  }

  it("moves an outage to the fallback on its own model and ceiling, and logs both calls", async () => {
    process.env.AZURE_OPENAI_MAX_OUTPUT_TOKENS = "4096";
    const res = await call({ maxTokens: 50_000 });
    expect(res.text).toBe("from azure");
    expect(res.provider).toBe("azure");

    expect(calls.map((c) => c.target)).toEqual(["primary", "fallback"]);
    expect(calls[0]!.opts.maxTokens).toBe(32_000);
    // Azure is deployment-pinned: no Claude model name leaks into the fallback call.
    expect(calls[1]!.opts.model).toBeUndefined();
    expect(calls[1]!.opts.maxTokens).toBe(4_096);
    expect(calls[1]!.opts.system).toBe(calls[0]!.opts.system);

    const logged = await rows();
    expect(logged.map((r) => r.status)).toEqual(["error", "ok"]);
    expect(logged[0]!.error).toBe("Anthropic 529: overloaded (falling back to azure)");
    expect(logged[1]).toMatchObject({ provider: "azure", model: "gpt-4o", requestedModel: "", inputTokens: 2, outputTokens: 3 });
  });

  it("falls back on a missed deadline or a dropped connection too", async () => {
    primaryError = new TypeError("fetch failed");
    expect((await call()).provider).toBe("azure");
  });

  it("leaves a bad request standing", async () => {
    primaryError = new ProviderHttpError("Anthropic 400: prompt is too long", 400);
    await expect(call()).rejects.toThrow("Anthropic 400");
    expect(calls.map((c) => c.target)).toEqual(["primary"]);
    const logged = await rows();
    expect(logged).toHaveLength(1);
    expect(logged[0]!.error).toBe("Anthropic 400: prompt is too long");
  });

  it("does not send attached documents to a fallback that cannot read them", async () => {
    await expect(
      call({ documents: [{ name: "rfp.pdf", mediaType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }] }),
    ).rejects.toThrow("Anthropic 529");
    expect(calls.map((c) => c.target)).toEqual(["primary"]);
  });

  it("does not repeat text the user has already seen streaming", async () => {
    streamBeforeFailing = true;
    await expect(call({ onDelta: () => {} })).rejects.toThrow("Anthropic 529");
    expect(calls.map((c) => c.target)).toEqual(["primary"]);
  });

  it("rethrows the original error when no fallback is configured", async () => {
    delete process.env.AI_FALLBACK_PROVIDER;
    await expect(call()).rejects.toThrow("Anthropic 529");
    expect(calls).toHaveLength(1);
    expect((await rows()).map((r) => r.error)).toEqual(["Anthropic 529: overloaded"]);
  });

  it("logs and rethrows a fallback that fails as well", async () => {
    fallbackError = new ProviderHttpError("Azure OpenAI 503: unavailable", 503);
    await expect(call()).rejects.toThrow("Azure OpenAI 503");
    const logged = await rows();
    expect(logged.map((r) => r.status)).toEqual(["error", "error"]);
    expect(logged[1]!.error).toBe("fallback azure: Azure OpenAI 503: unavailable");
  });

  it("refuses documents up front when the active provider cannot read them", async () => {
    process.env.AI_PROVIDER = "azure";
    delete process.env.AI_FALLBACK_PROVIDER;
    await expect(
      call({ documents: [{ name: "scan.png", mediaType: "image/png", bytes: new Uint8Array([1]) }] }),
    ).rejects.toThrow("cannot read attached documents");
    expect(calls).toHaveLength(0);
    expect((await rows()).map((r) => r.status)).toEqual(["error"]);
  });
});
