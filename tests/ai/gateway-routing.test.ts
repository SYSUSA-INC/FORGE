/**
 * BL-AI-ROUTING — runtime tests for per-feature model routing.
 *
 * Layer 1 (pure): `resolveModelForFeature` precedence and provider
 * tables under controlled env.
 *
 * Layer 2 (gateway through the seam): with the Anthropic provider
 * selected in env (the seam intercepts before any network), the gateway
 * requests the class model for the feature, honours a caller-pinned
 * model, honours tenant overrides from the subscription row, does
 * nothing when routing is off, and records the routed model in
 * ai_call_log.requested_model.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiCallLogs } from "@/db/schema";
import {
  createTierAndSubscribe,
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";
import {
  __setCompleteImplForTest,
  completeForTenant,
  type AICompleteOptions,
} from "@/lib/ai";
import {
  AI_FEATURE_MODEL_CLASS,
  DEFAULT_ANTHROPIC_FAST_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  modelTableFor,
  resolveModelForFeature,
  routingEnabled,
} from "@/lib/ai-routing";
import { AI_FEATURES } from "@/lib/ai-features";

const ENV_KEYS = [
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_MODEL_FAST",
  "ANTHROPIC_MODEL_STRONG",
  "AI_MODEL_ROUTING",
  "VLLM_MODEL",
  "VLLM_MODEL_FAST",
  "VLLM_MODEL_STRONG",
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
function clearRoutingEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

// ── Layer 1: pure resolution ──────────────────────────────────────────

describe("BL-AI-ROUTING — resolveModelForFeature", () => {
  beforeEach(() => {
    snapshotEnv();
    clearRoutingEnv();
  });
  afterEach(restoreEnv);

  it("every feature has a class", () => {
    for (const f of Object.keys(AI_FEATURES)) {
      expect(AI_FEATURE_MODEL_CLASS[f as keyof typeof AI_FEATURES]).toBeDefined();
    }
  });

  it("anthropic defaults: fast=haiku, standard=default, strong=standard (no silent upgrade)", () => {
    const t = modelTableFor("anthropic");
    expect(t.fast).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);
    expect(t.standard).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(t.strong).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it("anthropic env overrides each class independently", () => {
    process.env.ANTHROPIC_MODEL = "std-x";
    process.env.ANTHROPIC_MODEL_FAST = "fast-x";
    process.env.ANTHROPIC_MODEL_STRONG = "strong-x";
    const t = modelTableFor("anthropic");
    expect(t).toEqual({ fast: "fast-x", standard: "std-x", strong: "strong-x" });

    delete process.env.ANTHROPIC_MODEL_STRONG;
    expect(modelTableFor("anthropic").strong).toBe("std-x");
  });

  it("azure / bedrock / stub are not routed", () => {
    for (const p of ["azure", "bedrock", "stub"] as const) {
      expect(modelTableFor(p)).toEqual({ fast: null, standard: null, strong: null });
      expect(
        resolveModelForFeature({ feature: "section_draft", provider: p }),
      ).toMatchObject({ model: null, source: "none" });
    }
  });

  it("vllm routes fast/strong to standard unless set", () => {
    process.env.VLLM_MODEL = "llama-std";
    expect(modelTableFor("vllm")).toEqual({
      fast: "llama-std",
      standard: "llama-std",
      strong: "llama-std",
    });
    process.env.VLLM_MODEL_STRONG = "llama-70b";
    expect(modelTableFor("vllm").strong).toBe("llama-70b");
  });

  it("class mapping picks the right table entry per feature", () => {
    process.env.ANTHROPIC_MODEL_STRONG = "strong-x";
    expect(
      resolveModelForFeature({ feature: "knowledge_classify", provider: "anthropic" }),
    ).toEqual({ model: DEFAULT_ANTHROPIC_FAST_MODEL, modelClass: "fast", source: "provider_table" });
    expect(
      resolveModelForFeature({ feature: "solicitation_extract", provider: "anthropic" }),
    ).toEqual({ model: DEFAULT_ANTHROPIC_MODEL, modelClass: "standard", source: "provider_table" });
    expect(
      resolveModelForFeature({ feature: "section_draft", provider: "anthropic" }),
    ).toEqual({ model: "strong-x", modelClass: "strong", source: "provider_table" });
  });

  it("tenant override precedence: feature key beats class key beats table", () => {
    const byClass = resolveModelForFeature({
      feature: "section_draft",
      provider: "anthropic",
      tenantOverrides: { strong: "tenant-strong" },
    });
    expect(byClass).toEqual({ model: "tenant-strong", modelClass: "strong", source: "tenant_class" });

    const byFeature = resolveModelForFeature({
      feature: "section_draft",
      provider: "anthropic",
      tenantOverrides: { strong: "tenant-strong", section_draft: "tenant-draft" },
    });
    expect(byFeature).toEqual({ model: "tenant-draft", modelClass: "strong", source: "tenant_feature" });

    // Blank / non-string overrides are ignored.
    const blank = resolveModelForFeature({
      feature: "section_draft",
      provider: "anthropic",
      tenantOverrides: { section_draft: "   " },
    });
    expect(blank.source).toBe("provider_table");
  });

  it("routingEnabled honours AI_MODEL_ROUTING=off only", () => {
    expect(routingEnabled()).toBe(true);
    process.env.AI_MODEL_ROUTING = "OFF";
    expect(routingEnabled()).toBe(false);
    process.env.AI_MODEL_ROUTING = "anything-else";
    expect(routingEnabled()).toBe(true);
  });
});

// ── Layer 2: gateway through the seam ─────────────────────────────────

let seenOpts: AICompleteOptions | null = null;

describe("BL-AI-ROUTING — gateway applies routing (runtime)", () => {
  let fx: TwoTenantFixture;
  let cleanupTier: () => Promise<void> = async () => {};

  beforeEach(async () => {
    snapshotEnv();
    clearRoutingEnv();
    // Select Anthropic so routing has a table; the seam replaces the
    // real provider call, so the key value is never used.
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    process.env.ANTHROPIC_MODEL_STRONG = "strong-from-env";

    fx = await createTwoTenants("ai-routing");
    seenOpts = null;
    __setCompleteImplForTest(async (opts) => {
      seenOpts = opts;
      return {
        text: "ok",
        provider: "anthropic" as const,
        model: opts.model ?? "provider-default",
        inputTokens: 1,
        outputTokens: 1,
        stubbed: false,
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await cleanupTier();
    cleanupTier = async () => {};
    await fx.cleanup();
    restoreEnv();
  });

  it("routes a fast feature to the fast model and records it in requested_model", async () => {
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "knowledge_classify",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.model).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);

    const [row] = await db
      .select()
      .from(aiCallLogs)
      .where(eq(aiCallLogs.organizationId, fx.orgA.organizationId))
      .orderBy(asc(aiCallLogs.createdAt));
    expect(row?.requestedModel).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);
    expect(row?.model).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);
  });

  it("routes a strong feature to ANTHROPIC_MODEL_STRONG", async () => {
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.model).toBe("strong-from-env");
  });

  it("a caller-pinned model is never overridden", async () => {
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      model: "pinned-by-caller",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.model).toBe("pinned-by-caller");
  });

  it("tenant override from the subscription row wins over the env table", async () => {
    const tier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `route-${fx.orgA.organizationId.slice(0, 8)}`,
      name: "Routing test",
      overrides: { aiModels: { section_draft: "tenant-pinned-draft" } },
    });
    cleanupTier = tier.cleanup;

    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.model).toBe("tenant-pinned-draft");

    // Another feature in the same tenant still follows the table.
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "image_ocr",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.model).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);

    // Tenant B is unaffected by A's override.
    await completeForTenant({
      organizationId: fx.orgB.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.model).toBe("strong-from-env");
  });

  it("AI_MODEL_ROUTING=off leaves the model unset", async () => {
    process.env.AI_MODEL_ROUTING = "off";
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "knowledge_classify",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(seenOpts?.model).toBeUndefined();
  });
});
