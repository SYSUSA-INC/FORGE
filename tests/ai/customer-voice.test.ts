/**
 * BL-FB-GEN-VOC — voice of the customer, pure parts.
 */
import { describe, expect, it } from "vitest";
import { extractCustomerVoice, phraseCoverage, phraseKey, voiceGuidance } from "@/lib/customer-voice";

const sectionM =
  "Proposals will be evaluated on the offeror's zero trust architecture approach, its continuous monitoring capability, and demonstrated mission assurance for the warfighter.";
const requirements = [
  { text: "The contractor shall implement a zero trust architecture across all enclaves." },
  { text: "The contractor shall provide continuous monitoring of all enclaves and report incidents within one hour." },
  { text: "The contractor shall maintain mission assurance during transition." },
  { text: "Past performance shall be submitted in Volume II." },
];
const description = "NAVWAR delivers mission assurance and information warfare capability to the fleet.";

describe("extractCustomerVoice", () => {
  it("reads the agency's phrases, weighting evaluation language highest", () => {
    const phrases = extractCustomerVoice({ sectionMSummary: sectionM, requirements, description });
    const list = phrases.map((p) => p.phrase);
    expect(list[0]).toBe("mission assurance"); // evaluation 3 + requirement 1 + mission 2
    expect(list).toContain("zero trust architecture");
    expect(list).toContain("continuous monitoring");
    // Sub-phrases of an equally weighted longer phrase are folded into it.
    expect(list).not.toContain("zero trust");
    expect(list).not.toContain("trust architecture");
    // Generic proposal vocabulary never counts as the customer's voice.
    expect(list).not.toContain("past performance");
    const mission = phrases.find((p) => p.phrase === "mission assurance")!;
    expect(mission).toMatchObject({ weight: 6, source: "evaluation" });
    expect(mission.sample).toContain("evaluated");
    expect(phrases.find((p) => p.phrase === "zero trust architecture")).toMatchObject({ weight: 4, source: "evaluation" });
  });

  it("finds evaluation sentences in the full text by their cues and ignores the rest", () => {
    const rawText =
      "The Government will evaluate the Offeror's secure software supply chain practices. Deliveries shall occur monthly at the depot. Deliveries shall occur monthly at the depot.";
    const phrases = extractCustomerVoice({ rawText });
    const list = phrases.map((p) => p.phrase);
    expect(list).toContain("software supply chain");
    // A requirement-only sentence in raw text is not evaluation language and raw text is not a requirement source.
    expect(list).not.toContain("occur monthly");
    expect(extractCustomerVoice({})).toEqual([]);
    expect(extractCustomerVoice({ sectionMSummary: sectionM, requirements }, { max: 2 })).toHaveLength(2);
  });
});

describe("phraseCoverage / voiceGuidance / phraseKey", () => {
  it("matches stems so plurals and casing still count as echoed", () => {
    const phrases = extractCustomerVoice({ sectionMSummary: sectionM, requirements, description });
    const cov = phraseCoverage("We implement Zero Trust Architectures with Continuous Monitoring of every enclave.", phrases);
    expect(cov.echoed.map((p) => p.phrase)).toEqual(expect.arrayContaining(["zero trust architecture", "continuous monitoring"]));
    expect(cov.missing.map((p) => p.phrase)).toContain("mission assurance");
    expect(phraseCoverage("", phrases).echoed).toEqual([]);
    expect(phraseKey("Zero Trust Architectures")).toBe("zero trust architecture");
    expect(phraseKey("capabilities, policies")).toBe("capability policy");
  });

  it("caps and strips the guidance list for the prompt", () => {
    const phrases = extractCustomerVoice({ sectionMSummary: sectionM, requirements, description });
    const g = voiceGuidance(phrases, 2);
    expect(g).toHaveLength(2);
    expect(Object.keys(g[0]!).sort()).toEqual(["phrase", "source"]);
  });
});
