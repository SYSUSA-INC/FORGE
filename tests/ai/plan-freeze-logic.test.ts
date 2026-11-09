import { describe, expect, it } from "vitest";
import { developBlockers, developNote, frozenChangeNote, frozenState, isFrozen, isMaterialComplianceChange, NOT_FROZEN } from "@/lib/plan-freeze-logic";
import { plannedRound, planState, type PlanRoleLike } from "@/lib/plan-logic";

const row = (userId: string, role: PlanRoleLike["role"], colorTeam: string | null, raci: PlanRoleLike["raci"] = {}): PlanRoleLike => ({ id: `${userId}-${role}-${colorTeam}`, userId, role, colorTeam, raci });
const allA = row("u1", "proposal_manager", null, { management: "A", technical: "A", past_performance: "A", pricing: "A", compliance: "A", production: "A" });
const frozen = { matrix: true, outline: true };
const ready = planState([allA], 6, undefined, "signed", frozen);

describe("BL-NAV-LIFECYCLE 4c-2 — the freeze", () => {
  it("reads the stamps; frozen means both", () => {
    expect(frozenState(null)).toEqual(NOT_FROZEN);
    expect(frozenState({ complianceMatrixFrozenAt: new Date(), outlineFrozenAt: null })).toEqual({ matrix: true, outline: false });
    expect(isFrozen({ matrix: true, outline: false })).toBe(false);
    expect(isFrozen(frozen)).toBe(true);
  });

  it("notes a change to what the matrix requires or maps, not the work of Develop", () => {
    expect(isMaterialComplianceChange(["requirementText"])).toBe(true);
    expect(isMaterialComplianceChange(["status", "proposalSectionId"])).toBe(true);
    expect(isMaterialComplianceChange(["status", "notes", "ownerUserId", "ownerStatus"])).toBe(false);
  });

  it("words the Activity row so the Red team sees what moved and since when", () => {
    const at = "2026-11-09T10:00:00.000Z";
    expect(frozenChangeNote({ area: "matrix", action: "added", label: "L.3 Staffing" }, at)).toEqual({ title: "Compliance matrix changed after the freeze", body: "Requirement added: L.3 Staffing. Frozen 2026-11-09." });
    expect(frozenChangeNote({ area: "matrix", action: "changed", label: "L.3", fields: ["requirementText", "status"] }, at).body).toBe("Requirement changed (requirement text): L.3. Frozen 2026-11-09.");
    expect(frozenChangeNote({ area: "matrix", action: "imported", label: "", count: 1 }, at).body).toContain("1 requirement imported");
    expect(frozenChangeNote({ area: "outline", action: "removed", label: "Volume II" }, at)).toEqual({ title: "Outline changed after the freeze", body: "Section removed: Volume II. Frozen 2026-11-09." });
    expect(frozenChangeNote({ area: "outline", action: "rebuilt", label: "", count: 3 }, at).body).toContain("3 sections");
  });
});

describe("BL-NAV-LIFECYCLE 4c-2 — Move to Develop", () => {
  const open = { stage: "capture" as const, state: ready, frozen, isPartner: false, agreementStatus: "todo" };

  it("is open when the plan is complete", () => {
    expect(developBlockers(open)).toEqual([]);
  });

  it("lists what stands in the way, in the order the plan is filled", () => {
    const bare = developBlockers({ ...open, state: planState([], 0), frozen: NOT_FROZEN });
    expect(bare).toEqual([
      "Name an A (accountable) for Management, Technical, Past performance, Pricing, Compliance, Production.",
      "Sign the charter.",
      "Build the schedule: no milestones yet.",
      "Freeze the compliance matrix.",
      "Freeze the outline.",
    ]);
    expect(developBlockers({ ...open, frozen: { matrix: true, outline: false } })).toEqual(["Freeze the outline."]);
    expect(developBlockers({ ...open, state: planState([allA], 6, undefined, "draft", frozen) })).toEqual(["Sign the charter."]);
  });

  it("holds a PARTNER bid until the agreement is signed, and a solo bid does not wait for one", () => {
    expect(developBlockers({ ...open, isPartner: true })).toEqual(["Record the teaming agreement as signed."]);
    expect(developBlockers({ ...open, isPartner: true, agreementStatus: "negotiating" })).toHaveLength(1);
    expect(developBlockers({ ...open, isPartner: true, agreementStatus: "signed" })).toEqual([]);
  });

  it("moves only an opportunity that is in Plan", () => {
    expect(developBlockers({ ...open, stage: "pre_proposal" })[0]).toMatch(/in Plan/);
    expect(developBlockers({ ...open, stage: "qualification" })[0]).toMatch(/in Plan/);
  });

  it("leaves a note that says what was signed off", () => {
    expect(developNote({ isPartner: false, milestones: 6 })).toBe("Moved to Develop. The plan is signed off: team and RACI named, charter signed, 6 milestones set, compliance matrix and outline frozen.");
    expect(developNote({ isPartner: true, milestones: 1 })).toContain("1 milestone set");
    expect(developNote({ isPartner: true, milestones: 1 })).toContain("teaming agreement signed");
  });
});

describe("BL-NAV-LIFECYCLE 4c-2 — the colour team's planned round", () => {
  const rows = [row("u1", "color_team_reviewer", "red"), row("u2", "color_team_reviewer", "red"), row("u1", "color_team_reviewer", "red"), row("u3", "color_team_reviewer", "pink"), row("u4", "proposal_manager", null)];
  const milestones = [
    { kind: "red_team" as const, date: "2026-12-10", status: "planned" },
    { kind: "red_team" as const, date: "2026-12-01", status: "missed" },
    { kind: "pink_team" as const, date: "2026-11-20", status: "done" },
  ];

  it("gives the round the colour's reviewers once each and its live milestone date", () => {
    expect(plannedRound(rows, milestones, "red")).toEqual({ reviewerUserIds: ["u1", "u2"], dueDate: "2026-12-10" });
    expect(plannedRound(rows, milestones, "pink")).toEqual({ reviewerUserIds: ["u3"], dueDate: "2026-11-20" });
  });

  it("has nothing for a colour with no team or date, nor for green", () => {
    expect(plannedRound(rows, milestones, "gold")).toEqual({ reviewerUserIds: [], dueDate: null });
    expect(plannedRound(rows, milestones, "green")).toEqual({ reviewerUserIds: [], dueDate: null });
  });
});
