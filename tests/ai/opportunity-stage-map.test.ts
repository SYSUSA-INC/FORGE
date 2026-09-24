/**
 * BL-AIP-1 — one mapping for outcome → opportunity stage → rules event.
 */

import { describe, expect, it } from "vitest";
import {
  isClosedStage,
  ruleKindForStage,
  stageForOutcome,
} from "@/lib/opportunity-stage-map";

describe("opportunity-stage-map", () => {
  it("maps every proposal outcome to a terminal opportunity stage", () => {
    expect(stageForOutcome("won")).toBe("won");
    expect(stageForOutcome("lost")).toBe("lost");
    expect(stageForOutcome("no_bid")).toBe("no_bid");
    // A withdrawn bid is a decision not to compete; the pipeline treats it as a no-bid.
    expect(stageForOutcome("withdrawn")).toBe("no_bid");
  });

  it("fires the narrow closed-state rule for terminal stages and 'advanced' otherwise", () => {
    expect(ruleKindForStage("won")).toBe("opportunity_won");
    expect(ruleKindForStage("lost")).toBe("opportunity_lost");
    expect(ruleKindForStage("no_bid")).toBe("opportunity_no_bid");
    for (const s of ["identified", "sources_sought", "qualification", "capture", "pre_proposal", "writing", "submitted"] as const) {
      expect(ruleKindForStage(s)).toBe("opportunity_advanced");
      expect(isClosedStage(s)).toBe(false);
    }
    expect(isClosedStage("won")).toBe(true);
    expect(isClosedStage("lost")).toBe(true);
    expect(isClosedStage("no_bid")).toBe(true);
  });
});
