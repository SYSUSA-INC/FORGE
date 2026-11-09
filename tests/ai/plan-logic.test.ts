import { describe, expect, it } from "vitest";
import {
  diffTeam,
  normalizeRaci,
  PLAN_COLOR_TEAMS,
  PLAN_ROLES,
  planNextStep,
  planRoleAssignedMessage,
  planState,
  planStateLine,
  RACI_AREAS,
  withRaciLetter,
  type PlanRoleLike,
} from "@/lib/plan-logic";

const row = (over: Partial<PlanRoleLike> & { id: string; userId: string }): PlanRoleLike => ({ role: "contributor", colorTeam: null, raci: {}, ...over });

describe("BL-NAV-LIFECYCLE 4a — plan logic", () => {
  it("knows the nine solicitation roles plus executive sponsor and contracts, and four colour teams", () => {
    expect(PLAN_ROLES).toHaveLength(11);
    expect(PLAN_ROLES.slice(-2)).toEqual(["executive_sponsor", "contracts"]);
    expect(PLAN_COLOR_TEAMS).toEqual(["pink", "red", "gold", "white_gloves"]);
    expect(RACI_AREAS).toHaveLength(6);
  });

  it("normalizes a RACI to known areas and letters", () => {
    expect(normalizeRaci({ management: "A", pricing: "X", bogus: "R", technical: 3 })).toEqual({ management: "A" });
    expect(normalizeRaci(null)).toEqual({});
    expect(normalizeRaci("A")).toEqual({});
  });

  it("sets and clears one letter", () => {
    const a = withRaciLetter({}, "technical", "R");
    expect(a).toEqual({ technical: "R" });
    expect(withRaciLetter(a, "technical", "A")).toEqual({ technical: "A" });
    expect(withRaciLetter(a, "technical", null)).toEqual({});
    expect(a).toEqual({ technical: "R" });
  });

  it("seeds assignments the plan lacks and removes shared roles the solicitation dropped", () => {
    const plan = [
      row({ id: "p1", userId: "u1", role: "capture_lead" }),
      row({ id: "p2", userId: "u2", role: "contracts" }),
      row({ id: "p3", userId: "u3", role: "color_team_reviewer", colorTeam: "red" }),
      row({ id: "p4", userId: "u4", role: "observer" }),
    ];
    const diff = diffTeam(plan, [
      { userId: "u1", role: "capture_lead", notes: "" },
      { userId: "u3", role: "color_team_reviewer", notes: "" },
      { userId: "u5", role: "pricing_lead", notes: "costs" },
      { userId: "u5", role: "pricing_lead", notes: "dup" },
    ]);
    expect(diff.toAdd).toEqual([{ userId: "u5", role: "pricing_lead", notes: "costs" }]);
    expect(diff.toRemoveIds).toEqual(["p4"]);
  });

  it("keeps plan-only roles when the opportunity has assignments", () => {
    const diff = diffTeam([row({ id: "p1", userId: "u1", role: "executive_sponsor" })], []);
    expect(diff).toEqual({ toAdd: [], toRemoveIds: [] });
  });

  it("reads the plan's state and the next step in order", () => {
    expect(planNextStep(planState([]))).toBe("name_team");
    const team = [row({ id: "1", userId: "u1", role: "proposal_manager", raci: { management: "A", technical: "A" } })];
    expect(planNextStep(planState(team))).toBe("assign_raci");
    const allA = Object.fromEntries(RACI_AREAS.map((a) => [a, "A" as const]));
    const covered = [row({ id: "1", userId: "u1", role: "proposal_manager", raci: allA })];
    expect(planNextStep(planState(covered))).toBe("name_color_teams");
    const named = [...covered, ...PLAN_COLOR_TEAMS.map((c, i) => row({ id: `c${i}`, userId: `r${i}`, role: "color_team_reviewer", colorTeam: c }))];
    const noSchedule = planState(named);
    expect(noSchedule.colorTeamsNamed).toBe(4);
    expect(noSchedule.people).toBe(5);
    // 4b-1: the schedule comes after the colour teams.
    expect(planNextStep(noSchedule)).toBe("build_schedule");
    expect(planStateLine(noSchedule)).toBe("5 people · A for 6 of 6 areas · 4 of 4 colour teams · no schedule · no charter");
    // 4c-1: the charter comes after the parts; a signed one opens the plan.
    const state = planState(named, 6);
    expect(planNextStep(state)).toBe("sign_charter");
    const signed = planState(named, 6, undefined, "signed");
    expect(planNextStep(signed)).toBe("plan_ready");
    expect(planStateLine(signed)).toBe("5 people · A for 6 of 6 areas · 4 of 4 colour teams · 6 milestones · charter signed");
    expect(planStateLine(planState([], 1))).toContain("· 1 milestone");
  });

  it("does not count a colour-less reviewer, or green, as a named colour team", () => {
    const state = planState([row({ id: "1", userId: "u1", role: "color_team_reviewer" }), row({ id: "2", userId: "u2", role: "color_team_reviewer", colorTeam: "green" })]);
    expect(state.colorTeamsNamed).toBe(0);
    expect(state.people).toBe(2);
  });

  it("words the notification for a role and for a colour team", () => {
    expect(planRoleAssignedMessage({ actorName: "Ana", role: "pricing_lead", colorTeam: null, opportunityTitle: "Zero Trust", notes: "" })).toEqual({
      subject: "Named Pricing lead on the plan for Zero Trust",
      body: "Ana named you Pricing lead on the plan for Zero Trust.",
    });
    const m = planRoleAssignedMessage({ actorName: "Ana", role: "color_team_reviewer", colorTeam: "white_gloves", opportunityTitle: "", notes: "Final read" });
    expect(m.subject).toBe("Named White Gloves reviewer on the plan for an opportunity");
    expect(m.body).toContain("\n\nNotes: Final read");
  });
});
