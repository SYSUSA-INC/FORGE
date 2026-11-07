/**
 * BL-NAV-LIFECYCLE 3a — Capture's rules: a GO moves to Plan at once, a
 * PARTNER once a partner is chosen (the agreement stays to do), and what
 * each Capture row asks for next. Pure.
 */
import { describe, expect, it } from "vitest";
import { captureNextStep, emptyPartnerCounts, planBlocker, planNote } from "@/lib/capture-logic";

describe("Capture rules", () => {
  it("lets a GO move to Plan at once, a PARTNER once a partner is chosen", () => {
    expect(planBlocker({ stage: "qualification", decision: "go", chosen: 0 })).toBeNull();
    expect(planBlocker({ stage: "qualification", decision: "partner", chosen: 0 })).toMatch(/Choose a partner/);
    expect(planBlocker({ stage: "qualification", decision: "partner", chosen: 2 })).toBeNull();
    expect(planBlocker({ stage: "qualification", decision: null, chosen: 0 })).toBeNull();
    expect(planBlocker({ stage: "identified", decision: "go", chosen: 0 })).toMatch(/Only an opportunity in Capture/);
    expect(planBlocker({ stage: "qualification", decision: "no_go", chosen: 0 })).toMatch(/NO-GO/);
  });

  it("says what each row needs next", () => {
    const c = emptyPartnerCounts();
    expect(captureNextStep({ decision: "go", counts: c })).toBe("move_to_plan");
    expect(captureNextStep({ decision: "partner", counts: c })).toBe("find_partners");
    expect(captureNextStep({ decision: "partner", counts: { ...c, candidate: 2 } })).toBe("choose_partner");
    expect(captureNextStep({ decision: "partner", counts: { ...c, declined: 3 } })).toBe("find_partners");
    expect(captureNextStep({ decision: "partner", counts: { ...c, chosen: 1 } })).toBe("move_to_plan");
  });

  it("notes the partners and the agreement still to do", () => {
    expect(planNote({ decision: "partner", chosenNames: ["Alpha"] })).toBe("Moved to Plan with Alpha as partner. Teaming agreement: to do.");
    expect(planNote({ decision: "partner", chosenNames: ["Alpha", "Beta"] })).toMatch(/Alpha, Beta as partners/);
    expect(planNote({ decision: "go", chosenNames: [] })).toBe("Moved to Plan.");
  });
});
