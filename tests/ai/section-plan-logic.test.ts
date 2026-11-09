import { describe, expect, it } from "vitest";
import { isSectionOverdue, NO_PARTS, partsCount, sectionAssignedMessage, sectionHasDraft, sectionOverdueMessage } from "@/lib/section-plan-logic";
import { planNextStep, planState, planStateLine, type PlanRoleLike } from "@/lib/plan-logic";

describe("BL-NAV-LIFECYCLE 4b-2 — the parts' rules", () => {
  it("counts a draft only once the section left not_started with something written", () => {
    expect(sectionHasDraft({ status: "not_started", content: "words", wordCount: 1 })).toBe(false);
    expect(sectionHasDraft({ status: "in_progress", content: "", wordCount: 0 })).toBe(false);
    expect(sectionHasDraft({ status: "in_progress", content: "   ", wordCount: 0 })).toBe(false);
    expect(sectionHasDraft({ status: "in_progress", content: "A first paragraph.", wordCount: 3 })).toBe(true);
    expect(sectionHasDraft({ status: "approved", content: "", wordCount: 12 })).toBe(true);
  });

  it("is overdue only past the due date with no draft", () => {
    const empty = { status: "not_started" as const, content: "", wordCount: 0 };
    expect(isSectionOverdue({ todayIso: "2026-11-10", dueDate: "2026-11-09", draft: empty })).toBe(true);
    expect(isSectionOverdue({ todayIso: "2026-11-09", dueDate: "2026-11-09", draft: empty })).toBe(false);
    expect(isSectionOverdue({ todayIso: "2026-11-10", dueDate: null, draft: empty })).toBe(false);
    expect(isSectionOverdue({ todayIso: "2026-11-10", dueDate: "2026-11-09", draft: { status: "in_progress", content: "Started.", wordCount: 1 } })).toBe(false);
  });

  it("counts the parts, their owners and their dates, and folds them into the plan's state", () => {
    expect(partsCount([])).toEqual(NO_PARTS);
    const parts = [
      { authorUserId: "u1", dueDate: "2026-12-01" },
      { authorUserId: null, dueDate: "2026-12-01" },
      { authorUserId: "u2", dueDate: null },
    ];
    expect(partsCount(parts)).toEqual({ total: 3, owned: 2, dated: 2 });
    const line = planStateLine(planState([], 6, partsCount(parts)));
    expect(line).toBe("0 people · A for 0 of 6 areas · 0 of 4 colour teams · 6 milestones · parts owned 2 of 3 · no charter");
    expect(planStateLine(planState([], 6))).not.toContain("parts");
  });

  it("asks for the parts' owners after the schedule and before opening the plan", () => {
    const row = (userId: string, role: PlanRoleLike["role"], colorTeam: string | null, raci: Record<string, string>): PlanRoleLike => ({ id: userId, userId, role, colorTeam, raci } as PlanRoleLike);
    const areas = ["management", "technical", "past_performance", "pricing", "compliance", "production"];
    const full: PlanRoleLike[] = [
      row("u1", "proposal_manager", null, Object.fromEntries(areas.map((a) => [a, "A"]))),
      row("u2", "color_team_reviewer", "pink", {}),
      row("u3", "color_team_reviewer", "red", {}),
      row("u4", "color_team_reviewer", "gold", {}),
      row("u5", "color_team_reviewer", "white_gloves", {}),
    ];
    expect(planNextStep(planState(full, 6, undefined, "signed"))).toBe("plan_ready");
    expect(planNextStep(planState(full, 6, { total: 4, owned: 3, dated: 4 }, "signed"))).toBe("own_parts");
    expect(planNextStep(planState(full, 6, { total: 4, owned: 4, dated: 0 }, "signed"))).toBe("plan_ready");
    expect(planNextStep(planState(full, 0, { total: 4, owned: 3, dated: 4 }))).toBe("build_schedule");
  });

  it("words the assignment with the date when there is one, and the overdue notice with how late", () => {
    expect(sectionAssignedMessage({ sectionTitle: "Technical approach", byName: "Pat", dueDate: "2026-12-01" })).toEqual({
      subject: 'You were assigned "Technical approach"',
      body: 'Pat assigned you the "Technical approach" section. It is due 2026-12-01. Open the section editor to start drafting.',
    });
    expect(sectionAssignedMessage({ sectionTitle: "", byName: "", dueDate: null }).body).toBe('A teammate assigned you the "Untitled section" section. Open the section editor to start drafting.');
    const late = sectionOverdueMessage({ sectionTitle: "Pricing volume", proposalTitle: "Big RFP", dueDate: "2026-11-08", todayIso: "2026-11-09" });
    expect(late.subject).toBe("Overdue: Pricing volume — Big RFP");
    expect(late.body).toContain("was due 2026-11-08 (yesterday) and has no draft yet");
    expect(sectionOverdueMessage({ sectionTitle: "x", proposalTitle: "", dueDate: "2026-11-01", todayIso: "2026-11-09" }).body).toContain("of a proposal was due 2026-11-01 (8 days ago)");
  });
});
