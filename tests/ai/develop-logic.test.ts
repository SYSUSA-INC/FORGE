import { describe, expect, it } from "vitest";
import { DEVELOP_NEXT_STEP_LABELS, developNextStep, developStateLine, leadsFromTeam, NO_READINESS, readiness, type DevelopState } from "@/lib/develop-logic";

const sec = (title: string, status: "not_started" | "in_progress" | "approved", content: string, wordCount: number) => ({ title, status, content, wordCount });

describe("BL-NAV-LIFECYCLE 5a — leads from the plan's team", () => {
  it("takes the role holders, the manager falling back to the A for management", () => {
    const team = [
      { userId: "u1", role: "capture_lead", raci: {} },
      { userId: "u2", role: "pricing_lead", raci: {} },
      { userId: "u3", role: "contributor", raci: { management: "A" } },
    ];
    expect(leadsFromTeam(team)).toEqual({ proposalManagerUserId: "u3", captureManagerUserId: "u1", pricingLeadUserId: "u2" });
    expect(leadsFromTeam([...team, { userId: "u4", role: "proposal_manager", raci: {} }]).proposalManagerUserId).toBe("u4");
    expect(leadsFromTeam([])).toEqual({ proposalManagerUserId: null, captureManagerUserId: null, pricingLeadUserId: null });
  });
});

describe("BL-NAV-LIFECYCLE 5a — ready for Pink", () => {
  it("is ready only when every section has words and every requirement is mapped", () => {
    const ok = readiness([sec("A", "in_progress", "Words.", 1), sec("B", "approved", "", 40)], [{ mapped: true }]);
    expect(ok).toMatchObject({ ready: true, missing: [], sectionsDrafted: 2, requirementsMapped: 1 });
  });
  it("says what is missing, naming the first undrafted sections", () => {
    const r = readiness([sec("A", "not_started", "Words.", 1), sec("B", "in_progress", "", 0), sec("C", "in_progress", "x", 1), sec("D", "not_started", "", 0), sec("E", "not_started", "", 0)], [{ mapped: false }, { mapped: true }]);
    expect(r.ready).toBe(false);
    expect(r.missing[0]).toBe("4 of 5 sections have no draft yet: A, B, D and 1 more.");
    expect(r.missing[1]).toBe("1 of 2 requirements is not mapped to a section.");
  });
  it("is not ready with no sections", () => {
    expect(readiness([], []).missing).toEqual(["The proposal has no sections yet."]);
  });
});

describe("BL-NAV-LIFECYCLE 5a — next step and state line", () => {
  const none: DevelopState = { hasProposal: false, readiness: NO_READINESS, nextReview: null };
  const drafted = (over: Partial<DevelopState> = {}): DevelopState => ({ hasProposal: true, readiness: readiness([sec("A", "in_progress", "w", 1)], [{ mapped: true }]), nextReview: null, ...over });
  it("walks create → write → map → start Pink → open the review", () => {
    expect(developNextStep(none)).toBe("create_draft");
    expect(developNextStep({ ...drafted(), readiness: readiness([sec("A", "not_started", "", 0)], []) })).toBe("write_sections");
    expect(developNextStep({ ...drafted(), readiness: readiness([sec("A", "in_progress", "w", 1)], [{ mapped: false }]) })).toBe("map_requirements");
    expect(developNextStep(drafted())).toBe("start_pink");
    expect(developNextStep(drafted({ nextReview: { color: "pink", status: "scheduled", date: "2026-12-01" } }))).toBe("run_review");
    expect(developNextStep(drafted({ nextReview: { color: "pink", status: "complete", date: null } }))).toBe("start_pink");
    expect(DEVELOP_NEXT_STEP_LABELS.start_pink).toBe("Start Pink review");
  });
  it("writes the state line", () => {
    expect(developStateLine(none)).toBe("No draft yet");
    expect(developStateLine(drafted())).toBe("1 of 1 section drafted · 1 of 1 requirement mapped".replace("requirement mapped", "requirements mapped") + " · ready for Pink");
    expect(developStateLine(drafted({ nextReview: { color: "white_gloves", status: "scheduled", date: "2026-12-01" } }))).toContain("White gloves review 2026-12-01");
  });
});
