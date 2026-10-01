/**
 * BL-AIP-7d part ii — AI-assisted onboarding, pure parts: the status
 * rules, the proposal sanitizer, the registration-only fallback and the
 * prompt.
 */

import { describe, expect, it } from "vitest";
import { buildOnboardingAssistPrompt, onboardingAssistSchema } from "@/lib/ai-prompts";
import {
  agenciesToMetadata,
  fallbackProposal,
  onboardingStatus,
  proposalHasContent,
  sanitizeProposal,
  socioLabels,
  type OnboardingProfile,
} from "@/lib/onboarding-logic";

const socio = { sba8a: true, smallBusiness: true, sdb: false, wosb: false, sdvosb: true, hubzone: false };

const profile: OnboardingProfile = {
  name: "Acme Orbital Systems",
  uei: "ABC123DEF456",
  cageCode: "1ABC2",
  website: "https://acme.example",
  state: "VA",
  primaryNaics: "541512",
  naicsList: ["541512", "541519", "517410"],
  socioEconomic: socio,
  syncSource: "samgov",
};

describe("onboardingStatus", () => {
  it("opens every step for an empty organization and none for a complete one", () => {
    const empty = onboardingStatus({ uei: "", primaryNaics: "", naicsList: [], scoutKeywords: [], capabilityEntries: 0 });
    expect(empty.open).toEqual(["samgov", "naics", "scout", "capability"]);
    expect(empty.complete).toBe(false);

    const done = onboardingStatus({
      uei: "ABC123DEF456",
      primaryNaics: "541512",
      naicsList: [],
      scoutKeywords: ["zero trust"],
      capabilityEntries: 1,
    });
    expect(done.open).toEqual([]);
    expect(done.complete).toBe(true);
  });

  it("accepts NAICS from the list alone and ignores blank keywords", () => {
    const s = onboardingStatus({ uei: " ", primaryNaics: "", naicsList: ["541512"], scoutKeywords: [" "], capabilityEntries: 2 });
    expect(s).toMatchObject({ needsUei: true, needsNaics: false, needsScout: true, needsCapability: false, open: ["samgov", "scout"] });
  });
});

describe("sanitizeProposal", () => {
  it("trims, caps and de-duplicates every part", () => {
    const p = sanitizeProposal(
      {
        capabilityStatement: "  We build   things.  ",
        scoutKeywords: ["Zero Trust", "zero trust", " cloud  migration ", "x", 42, ...Array.from({ length: 20 }, (_, i) => `k${i}`)],
        extraNaics: ["541512", "518-210", "5415", "1", "518210", "541611", "541330", "541715", "541990"],
        targetAgencies: [
          { name: "DISA", why: "Buys zero-trust." },
          { name: "disa", why: "dupe" },
          { name: "", why: "no name" },
          "junk",
          ...Array.from({ length: 10 }, (_, i) => ({ name: `Agency ${i}`, why: "" })),
        ],
      },
      ["541512"],
    );
    expect(p.capabilityStatement).toBe("We build   things.");
    expect(p.scoutKeywords.slice(0, 2)).toEqual(["Zero Trust", "cloud migration"]);
    expect(p.scoutKeywords).toHaveLength(10);
    // Digits only, never a code the organization already has, max 5.
    expect(p.extraNaics).toEqual(["518210", "5415", "541611", "541330", "541715"]);
    expect(p.targetAgencies[0]).toEqual({ name: "DISA", why: "Buys zero-trust." });
    expect(p.targetAgencies).toHaveLength(6);
    expect(p.targetAgencies.some((a) => a.name.toLowerCase() === "disa" && a.why === "dupe")).toBe(false);
  });

  it("truncates a long statement and treats garbage as empty", () => {
    const long = sanitizeProposal({ capabilityStatement: "a".repeat(2_000) });
    expect(long.capabilityStatement.length).toBe(1_500);
    expect(long.capabilityStatement.endsWith("…")).toBe(true);
    const empty = sanitizeProposal(null);
    expect(empty).toEqual({ capabilityStatement: "", scoutKeywords: [], extraNaics: [], targetAgencies: [] });
    expect(proposalHasContent(empty)).toBe(false);
    expect(proposalHasContent(sanitizeProposal({ scoutKeywords: ["cloud"] }))).toBe(true);
  });
});

describe("fallbackProposal", () => {
  it("uses only the registration and never invents agencies", () => {
    const p = fallbackProposal(profile);
    expect(p.capabilityStatement).toContain("Acme Orbital Systems");
    expect(p.capabilityStatement).toContain("VA");
    expect(p.capabilityStatement).toContain("8(a)");
    expect(p.capabilityStatement).toContain("541512, 541519, 517410");
    expect(p.scoutKeywords).toEqual([
      "NAICS 541512",
      "NAICS 541519",
      "NAICS 517410",
      "8(a)",
      "small business",
      "service-disabled veteran-owned small business",
    ]);
    expect(p.extraNaics).toEqual([]);
    expect(p.targetAgencies).toEqual([]);
    expect(fallbackProposal(profile)).toEqual(p);
  });

  it("copes with a registration that has nothing", () => {
    const p = fallbackProposal({ ...profile, name: "", state: "", primaryNaics: "", naicsList: [], socioEconomic: { ...socio, sba8a: false, smallBusiness: false, sdvosb: false } });
    expect(p.capabilityStatement.startsWith("The company is a federal contractor.")).toBe(true);
    expect(p.scoutKeywords).toEqual([]);
  });
});

describe("helpers and prompt", () => {
  it("labels set-asides and flattens agencies for metadata", () => {
    expect(socioLabels(socio)).toEqual(["8(a)", "Small business", "Service-disabled veteran-owned small business"]);
    expect(socioLabels(null)).toEqual([]);
    expect(agenciesToMetadata([{ name: "DISA", why: "Buys zero-trust." }, { name: "NASA", why: "" }])).toBe("DISA — Buys zero-trust.; NASA");
  });

  it("builds a prompt from the registration and validates the schema", () => {
    const prompt = buildOnboardingAssistPrompt({
      name: profile.name,
      state: profile.state,
      website: profile.website,
      primaryNaics: profile.primaryNaics,
      naicsList: profile.naicsList,
      certifications: socioLabels(socio),
      sbaDescriptions: [],
    });
    expect(prompt.system).toContain("record_onboarding_setup");
    expect(prompt.system).toContain("never invent contracts");
    expect(prompt.messages[0]!.content).toContain('"primaryNaics": "541512"');
    expect(prompt.messages[0]!.content).toContain("Acme Orbital Systems");
    expect(
      onboardingAssistSchema.safeParse({
        capabilityStatement: "x",
        scoutKeywords: ["a"],
        extraNaics: [],
        targetAgencies: [{ name: "DISA", why: "y" }],
      }).success,
    ).toBe(true);
    expect(onboardingAssistSchema.safeParse({ capabilityStatement: "x" }).success).toBe(false);
  });
});
