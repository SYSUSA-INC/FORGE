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
  timelineLayout,
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

  describe("the timeline (4b-2)", () => {
    const today = "2026-11-09";
    const anchor = { iso: "2026-12-19", key: "response_due" };
    const ms = (id: string, kind: Parameters<typeof timelineLayout>[0]["milestones"][number]["kind"], date: string, status: "planned" | "done" | "missed" = "planned") => ({ id, title: id, kind, date, status });

    it("draws nothing when there is nothing to draw", () => {
      expect(timelineLayout({ todayIso: today, anchor: null, keyDates: [], milestones: [] })).toBeNull();
    });

    it("spans from the earliest day to the due date, with today as the marker and the key dates as marks", () => {
      const layout = timelineLayout({
        todayIso: today,
        anchor,
        keyDates: [
          { label: "Q&A cut-off", isoDate: "2026-11-19", type: "qa_cutoff" },
          { label: "Award", isoDate: "2027-02-01", type: "award" },
          { label: "Due", isoDate: "2026-12-19", type: "proposal_due" },
        ],
        milestones: [ms("submit", "submit", "2026-12-17"), ms("kick", "kick_off", today), ms("pink", "pink_team", "2026-11-19"), ms("red", "red_team", "2026-11-29", "done")],
        partDueDates: ["2026-11-25", "2026-11-25", "2027-01-01"],
      })!;
      expect(layout.startIso).toBe(today);
      expect(layout.endIso).toBe("2026-12-19");
      expect(layout.days).toBe(40);
      expect(layout.todayPct).toBe(0);
      // Bars in date order, each from the one before it to its own day; the first gets the minimum width.
      expect(layout.bars.map((b) => [b.id, b.startPct, Math.round(b.endPct * 10) / 10, b.overdue])).toEqual([
        ["kick", 0, 1.5, false],
        ["pink", 0, 25, false],
        ["red", 25, 50, false],
        ["submit", 50, 95, false],
      ]);
      // The due date once (not again as the proposal_due key date), the key dates inside the span, the parts folded per day; the award and the January part fall outside.
      expect(layout.marks.map((m) => [m.kind, m.label, m.iso, m.pct])).toEqual([
        ["key_date", "Q&A cut-off", "2026-11-19", 25],
        ["parts", "2 parts due", "2026-11-25", 40],
        ["due", "Response due", "2026-12-19", 100],
      ]);
    });

    it("starts before today when a milestone is in the past, marks it overdue, and ends at the latest date without a due date", () => {
      const layout = timelineLayout({ todayIso: today, anchor: null, keyDates: [], milestones: [ms("late", "other", "2026-11-05"), ms("next", "other", "2026-11-15")] })!;
      expect([layout.startIso, layout.endIso, layout.days]).toEqual(["2026-11-05", "2026-11-15", 10]);
      expect(layout.todayPct).toBe(40);
      expect(layout.bars[0].overdue).toBe(true);
      expect(layout.bars[1].endPct).toBe(100);
      expect(layout.marks).toEqual([]);
    });

    it("never divides by zero when everything falls on one day", () => {
      const layout = timelineLayout({ todayIso: today, anchor: { iso: today, key: "response_due" }, keyDates: [], milestones: [ms("a", "kick_off", today), ms("b", "submit", today)] })!;
      expect(layout.days).toBe(1);
      expect(layout.bars.every((b) => b.endPct >= b.startPct && b.endPct <= 100)).toBe(true);
    });
  });
});
