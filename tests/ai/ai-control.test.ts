/**
 * BL-AIP-7c — the AI Engine control panel, pure parts, plus the
 * class-valued feature override in the router.
 */

import { describe, expect, it } from "vitest";
import { applyAiBudget, burnDown, featureRoutingRows, sanitizeBudget } from "@/lib/ai-control";
import { AI_FEATURES } from "@/lib/ai-features";
import { resolveModelForFeature } from "@/lib/ai-routing";

const quotas = { aiRequestsPerMonth: 1000, aiTokensPerMonth: 2_000_000, seatsIncluded: 5, storageGb: 10, proposalsPerMonth: 0 };

describe("sanitizeBudget / applyAiBudget", () => {
  it("keeps only values that lower the tier cap", () => {
    expect(sanitizeBudget({ tokensPerMonth: 500_000, requestsPerMonth: 200 }, quotas)).toEqual({
      tokensPerMonth: 500_000,
      requestsPerMonth: 200,
    });
    // At or above the cap, negative, zero, junk: cleared.
    expect(sanitizeBudget({ tokensPerMonth: 2_000_000, requestsPerMonth: 5_000 }, quotas)).toEqual({});
    expect(sanitizeBudget({ tokensPerMonth: -1, requestsPerMonth: 0 }, quotas)).toEqual({});
    expect(sanitizeBudget({ tokensPerMonth: "abc", requestsPerMonth: "150.9" }, quotas)).toEqual({ requestsPerMonth: 150 });
    // An unlimited tier accepts any positive budget.
    expect(sanitizeBudget({ tokensPerMonth: 9_000_000 }, { ...quotas, aiTokensPerMonth: 0 })).toEqual({
      tokensPerMonth: 9_000_000,
    });
  });

  it("only lowers the effective quotas", () => {
    expect(applyAiBudget(quotas, { tokensPerMonth: 500_000 })).toMatchObject({
      aiTokensPerMonth: 500_000,
      aiRequestsPerMonth: 1000,
      seatsIncluded: 5,
    });
    expect(applyAiBudget(quotas, { tokensPerMonth: 5_000_000, requestsPerMonth: 2_000 })).toEqual(quotas);
    expect(applyAiBudget({ ...quotas, aiTokensPerMonth: 0 }, { tokensPerMonth: 100 })).toMatchObject({
      aiTokensPerMonth: 100,
    });
    expect(applyAiBudget(quotas, null)).toEqual(quotas);
    expect(applyAiBudget(quotas, {})).toEqual(quotas);
  });
});

describe("burnDown", () => {
  // 2026-09-16 12:00 UTC: 15.5 days elapsed of 30.
  const now = new Date("2026-09-16T12:00:00Z");

  it("projects the month from the pace so far and names the day the cap is reached", () => {
    const b = burnDown({ used: 310_000, cap: 600_000, now });
    expect(b).toMatchObject({ used: 310_000, cap: 600_000, percent: 51.7, dayOfMonth: 16, daysInMonth: 30 });
    expect(b.perDay).toBeCloseTo(20_000, 5);
    expect(b.projected).toBe(600_000);
    expect(b.capDay).toBe(30);
    expect(b.status).toBe("approaching");
  });

  it("is healthy when the cap is out of reach this month, at cap when used up, unlimited without a cap", () => {
    expect(burnDown({ used: 155_000, cap: 600_000, now })).toMatchObject({ capDay: null, status: "healthy", projected: 300_000 });
    expect(burnDown({ used: 600_000, cap: 600_000, now })).toMatchObject({ capDay: null, status: "at_cap", percent: 100 });
    expect(burnDown({ used: 5, cap: 0, now })).toMatchObject({ percent: null, capDay: null, status: "unlimited" });
    // 80 % used is "approaching" even if the pace would not reach the cap.
    expect(burnDown({ used: 480_000, cap: 600_000, now: new Date("2026-09-29T00:00:00Z") }).status).toBe("approaching");
    // First minutes of the month: the pace is the use so far.
    expect(burnDown({ used: 10, cap: 100, now: new Date("2026-10-01T00:00:00Z") })).toMatchObject({ perDay: 10, projected: 310 });
  });
});

describe("featureRoutingRows + class-valued overrides", () => {
  it("routes a class override through the provider table and keeps a pinned model literal", () => {
    const rows = featureRoutingRows({ section_draft: "fast", proposal_scan: "claude-opus-5" }, "anthropic");
    expect(rows).toHaveLength(Object.keys(AI_FEATURES).length);
    const draft = rows.find((r) => r.feature === "section_draft")!;
    expect(draft).toMatchObject({
      defaultClass: "strong",
      override: { kind: "class", cls: "fast" },
      effectiveClass: "fast",
      source: "tenant_feature_class",
    });
    expect(draft.effectiveModel).toBe(resolveModelForFeature({ feature: "knowledge_classify", provider: "anthropic" }).model);
    const scan = rows.find((r) => r.feature === "proposal_scan")!;
    expect(scan).toMatchObject({ override: { kind: "model", model: "claude-opus-5" }, effectiveModel: "claude-opus-5", source: "tenant_feature" });
    const brief = rows.find((r) => r.feature === "opportunity_brief")!;
    expect(brief).toMatchObject({ override: null, effectiveClass: "standard", source: "provider_table" });
  });

  it("falls back to the provider default when the class has no model (stub provider)", () => {
    expect(resolveModelForFeature({ feature: "section_draft", provider: "stub", tenantOverrides: { section_draft: "fast" } })).toEqual({
      model: null,
      modelClass: "fast",
      source: "none",
    });
    expect(featureRoutingRows(null, "stub").every((r) => r.effectiveModel === null && r.override === null)).toBe(true);
  });
});
