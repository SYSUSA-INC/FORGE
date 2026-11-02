import { describe, expect, it } from "vitest";
import { LIFECYCLE, lifecycleForOpportunity, lifecycleForProposal, lifecycleIndex, lifecycleStage } from "@/lib/lifecycle";
import { STAGES } from "@/lib/opportunity-types";

/** BL-NAV-LIFECYCLE — the seven stages, their pages, and where a pursuit sits. */
describe("lifecycle", () => {
  it("has the seven stages in the owner's order, each a page under /pipeline", () => {
    expect(LIFECYCLE.map((s) => s.label)).toEqual(["Identify", "Evaluate", "Capture", "Plan", "Develop", "Deliver", "Measure"]);
    for (const s of LIFECYCLE) {
      expect(s.href).toBe(`/pipeline/${s.key}`);
      expect(s.description.length).toBeGreaterThan(20);
    }
    expect(lifecycleIndex("plan")).toBe(3);
    expect(lifecycleStage("deliver")?.label).toBe("Deliver");
    expect(lifecycleStage("nonsense")).toBeNull();
  });

  it("covers every pipeline stage exactly once across the stage pages, Identify listing none", () => {
    const listed = LIFECYCLE.flatMap((s) => s.lists);
    expect(new Set(listed).size).toBe(listed.length);
    const all = [...STAGES.map((s) => s.key), "writing"];
    for (const key of all) expect(listed).toContain(key);
    expect(lifecycleStage("identify")?.lists).toEqual([]);
  });

  it("maps every opportunity stage, the merged writing stage included", () => {
    // An identified opportunity is waiting in Evaluate; Identify itself holds no list.
    expect(lifecycleForOpportunity("identified")).toBe("evaluate");
    expect(lifecycleForOpportunity("sources_sought")).toBe("evaluate");
    expect(lifecycleForOpportunity("qualification")).toBe("capture");
    expect(lifecycleForOpportunity("capture")).toBe("plan");
    expect(lifecycleForOpportunity("pre_proposal")).toBe("develop");
    expect(lifecycleForOpportunity("writing")).toBe("develop");
    expect(lifecycleForOpportunity("submitted")).toBe("deliver");
    for (const closed of ["won", "lost", "no_bid"]) expect(lifecycleForOpportunity(closed)).toBe("measure");
    expect(lifecycleForOpportunity("something-new")).toBe("identify");
  });

  it("maps every proposal stage", () => {
    for (const s of ["draft", "pink_team", "red_team", "gold_team"]) expect(lifecycleForProposal(s)).toBe("develop");
    for (const s of ["white_gloves", "submitted"]) expect(lifecycleForProposal(s)).toBe("deliver");
    for (const s of ["awarded", "lost", "no_bid", "archived"]) expect(lifecycleForProposal(s)).toBe("measure");
  });
});
