import { describe, expect, it } from "vitest";
import {
  addDays,
  COUNT_BACK_DAYS,
  daysBetween,
  isIsoDay,
  MILESTONE_KINDS,
  milestoneDueSoonMessage,
  milestoneHorizon,
  proposeSchedule,
  scheduleAnchor,
  scheduleState,
} from "@/lib/milestone-logic";

describe("BL-NAV-LIFECYCLE 4b-1 — milestone logic", () => {
  it("knows the ten kinds and the owner's count-back (decision 4)", () => {
    expect(MILESTONE_KINDS).toHaveLength(10);
    expect(MILESTONE_KINDS).toContain("white_gloves");
    expect(COUNT_BACK_DAYS).toEqual({ submit: 2, white_gloves: 4, gold_team: 10, red_team: 20, pink_team: 30 });
  });

  it("does day arithmetic on ISO days without a timezone", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-09", "2026-11-16")).toBe(7);
    expect(daysBetween("2026-11-09", "2026-11-08")).toBe(-1);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-1-5")).toBe(false);
  });

  it("hangs the schedule on the response due date, else the proposal_due key date, else nothing", () => {
    expect(scheduleAnchor({ responseDueIso: "2027-01-15", keyDates: [{ label: "Due", isoDate: "2027-01-10", type: "proposal_due" }] })).toEqual({ iso: "2027-01-15", key: "response_due" });
    expect(scheduleAnchor({ responseDueIso: null, keyDates: [{ label: "Due", isoDate: "2027-01-10", type: "proposal_due" }] })).toEqual({ iso: "2027-01-10", key: "proposal_due" });
    expect(scheduleAnchor({ responseDueIso: null, keyDates: [{ label: "Q&A", isoDate: "2026-12-01", type: "qa_cutoff" }] })).toBeNull();
  });

  it("proposes the kick-off today and the count-back from the due date, in date order", () => {
    const out = proposeSchedule({ todayIso: "2026-11-09", responseDueIso: "2027-01-15", keyDates: [] });
    expect(out.map((m) => [m.kind, m.date, m.anchorKey, m.clamped])).toEqual([
      ["kick_off", "2026-11-09", null, false],
      ["pink_team", "2026-12-16", "response_due", false],
      ["red_team", "2026-12-26", "response_due", false],
      ["gold_team", "2027-01-05", "response_due", false],
      ["white_gloves", "2027-01-11", "response_due", false],
      ["submit", "2027-01-13", "response_due", false],
    ]);
    expect(out[1].title).toBe("Pink team");
  });

  it("moves a round that would fall before today to today, and keeps the order", () => {
    const out = proposeSchedule({ todayIso: "2026-11-09", responseDueIso: "2026-11-20", keyDates: [] });
    expect(out.map((m) => [m.kind, m.date, m.clamped])).toEqual([
      ["kick_off", "2026-11-09", false],
      ["pink_team", "2026-11-09", true],
      ["red_team", "2026-11-09", true],
      ["gold_team", "2026-11-10", false],
      ["white_gloves", "2026-11-16", false],
      ["submit", "2026-11-18", false],
    ]);
  });

  it("leaves out kinds already on the plan, and proposes only the kick-off without a due date", () => {
    const again = proposeSchedule({ todayIso: "2026-11-09", responseDueIso: "2027-01-15", keyDates: [], existingKinds: ["kick_off", "pink_team", "submit"] });
    expect(again.map((m) => m.kind)).toEqual(["red_team", "gold_team", "white_gloves"]);
    const none = proposeSchedule({ todayIso: "2026-11-09", responseDueIso: null, keyDates: [] });
    expect(none.map((m) => m.kind)).toEqual(["kick_off"]);
    expect(proposeSchedule({ todayIso: "2026-11-09", responseDueIso: null, keyDates: [], existingKinds: ["kick_off"] })).toEqual([]);
  });

  it("reads the schedule's state: counts, overdue and the next day", () => {
    const state = scheduleState(
      [
        { kind: "kick_off", date: "2026-11-01", status: "done" },
        { kind: "pink_team", date: "2026-11-05", status: "planned" },
        { kind: "red_team", date: "2026-11-20", status: "planned" },
        { kind: "gold_team", date: "2026-11-09", status: "planned" },
        { kind: "other", date: "2026-10-30", status: "missed" },
      ],
      "2026-11-09",
    );
    expect(state).toEqual({ total: 5, planned: 3, done: 1, missed: 1, overdue: 1, nextDate: "2026-11-09" });
    expect(scheduleState([], "2026-11-09").nextDate).toBeNull();
  });

  it("reminds at T-7, T-3 and T-1 only, and words the reminder", () => {
    expect(milestoneHorizon("2026-11-09", "2026-11-16")).toBe(7);
    expect(milestoneHorizon("2026-11-09", "2026-11-12")).toBe(3);
    expect(milestoneHorizon("2026-11-09", "2026-11-10")).toBe(1);
    expect(milestoneHorizon("2026-11-09", "2026-11-11")).toBeNull();
    expect(milestoneHorizon("2026-11-09", "2026-11-09")).toBeNull();
    expect(milestoneDueSoonMessage({ horizon: 1, title: "Red team", dateIso: "2026-11-10", opportunityTitle: "Zero Trust" })).toEqual({
      subject: "[T-1] Red team — Zero Trust",
      body: "The Red team milestone on the plan for Zero Trust is tomorrow (2026-11-10).",
    });
    expect(milestoneDueSoonMessage({ horizon: 7, title: "Submit", dateIso: "2026-11-16", opportunityTitle: "" }).body).toBe("The Submit milestone on the plan for an opportunity is in 7 days (2026-11-16).");
  });
});
