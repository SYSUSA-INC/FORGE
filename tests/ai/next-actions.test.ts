import { describe, expect, it } from "vitest";
import {
  NEXT_ACTION_KINDS,
  NEXT_ACTION_MAX,
  NEXT_ACTION_RULES,
  mayDecideNextAction,
  nextActionsTakenRate,
  proposeNextActions,
  rankOrgActions,
  reconcileNextActions,
  type PursuitState,
  type StoredNextAction,
} from "@/lib/next-actions";

const NOW = new Date("2026-10-31T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function state(over: Partial<PursuitState> = {}): PursuitState {
  return {
    opportunityId: "opp1",
    stage: "identified",
    responseDueDate: days(40),
    awardDate: null,
    solicitation: null,
    evaluationSaved: false,
    questionnaire: null,
    briefExists: false,
    incumbentRecorded: false,
    proposal: null,
    proposedLessons: 0,
    ...over,
  };
}

function proposal(over: Partial<NonNullable<PursuitState["proposal"]>> = {}): NonNullable<PursuitState["proposal"]> {
  return {
    id: "prop1",
    stage: "draft",
    submittedAt: null,
    sections: { total: 4, notStarted: 0, draftOrBetter: 4, overCap: 0 },
    compliance: { total: 10, mapped: 9 },
    reviews: { any: true, goldPassed: false },
    openComments: 0,
    lastScanAt: days(-1),
    lastSectionSavedAt: days(-2),
    outcome: null,
    debriefHeld: false,
    ...over,
  };
}

const kinds = (s: PursuitState) => proposeNextActions(s, NOW).map((a) => a.kind);

describe("the rule set", () => {
  it("has one rule per kind", () => {
    expect(new Set(NEXT_ACTION_KINDS).size).toBe(NEXT_ACTION_RULES.length);
  });

  it("S1 Identified: parse, score, brief; the gate when due within 14 days", () => {
    expect(kinds(state({ solicitation: { id: "sol1", parseStatus: "uploaded" } }))).toEqual(["parse_solicitation", "score_evaluation", "write_brief"]);
    const soon = proposeNextActions(state({ responseDueDate: days(10) }), NOW);
    expect(soon[0]).toMatchObject({ kind: "at_risk", priority: "now" });
    expect(soon.map((a) => a.kind)).toContain("gate_decision");
    expect(soon.find((a) => a.kind === "gate_decision")?.priority).toBe("now");
  });

  it("S2 Evaluated: build the questionnaire once parsed, then answer it, then the gate", () => {
    const parsed = { id: "sol1", parseStatus: "parsed" };
    expect(kinds(state({ stage: "sources_sought", solicitation: parsed, evaluationSaved: true }))).toEqual(["build_questionnaire"]);
    const q = { built: true, total: 12, answered: 5, suggestionsWaiting: 3, counting: false, partnerNeeded: false, shallGapsOpen: 0 };
    const answer = proposeNextActions(state({ stage: "sources_sought", solicitation: parsed, evaluationSaved: true, questionnaire: q }), NOW);
    expect(answer.map((a) => a.kind)).toEqual(["answer_questionnaire"]);
    expect(answer[0]!.title).toBe("Answer the 7 open questionnaire questions");
    expect(answer[0]!.reason).toContain("3 suggested answers waiting");
    expect(kinds(state({ stage: "sources_sought", solicitation: parsed, evaluationSaved: true, questionnaire: { ...q, answered: 12, counting: true } }))).toEqual(["gate_decision"]);
  });

  it("S3 Qualified: a partner when the questionnaire says so, the incumbent, the proposal when due within 45 days", () => {
    const q = { built: true, total: 12, answered: 12, suggestionsWaiting: 0, counting: true, partnerNeeded: true, shallGapsOpen: 2 };
    const out = proposeNextActions(state({ stage: "qualification", questionnaire: q }), NOW);
    expect(out.map((a) => a.kind)).toEqual(["find_partner", "create_proposal", "record_incumbent"]);
    expect(out[0]!.reason).toContain("2 shall-level gaps");
    expect(kinds(state({ stage: "qualification", responseDueDate: days(90), incumbentRecorded: true }))).toEqual([]);
  });

  it("S4 Captured: create the proposal, then build the outline once the solicitation is parsed", () => {
    expect(kinds(state({ stage: "capture" }))).toEqual(["create_proposal"]);
    const p = proposal({ sections: { total: 0, notStarted: 0, draftOrBetter: 0, overCap: 0 }, reviews: { any: false, goldPassed: false }, lastScanAt: null, lastSectionSavedAt: null, compliance: { total: 0, mapped: 0 } });
    expect(kinds(state({ stage: "capture", proposal: p, solicitation: { id: "sol1", parseStatus: "parsed" } }))).toEqual(["build_outline"]);
    expect(kinds(state({ stage: "capture", proposal: p }))).toEqual([]);
  });

  it("S5 Developed: drafts, compliance, the pink team, comments, caps, the scan, and submit when gold passed", () => {
    const p = proposal({
      sections: { total: 6, notStarted: 2, draftOrBetter: 4, overCap: 1 },
      compliance: { total: 20, mapped: 10 },
      reviews: { any: false, goldPassed: false },
      openComments: 3,
      lastScanAt: days(-3),
      lastSectionSavedAt: days(-1),
    });
    const all = proposeNextActions(state({ stage: "pre_proposal", proposal: p }), NOW);
    expect(all.map((a) => a.kind)).toEqual(["draft_sections", "map_compliance", "resolve_comments", "tighten_sections", "run_health_scan"]);
    expect(all.find((a) => a.kind === "map_compliance")?.reason).toContain("(50%)");
    expect(all.every((a) => a.proposalId === "prop1")).toBe(true);
    const ready = proposal({ reviews: { any: false, goldPassed: false } });
    expect(kinds(state({ stage: "pre_proposal", proposal: ready }))).toEqual(["start_review"]);
    const gold = proposal({ stage: "white_gloves", reviews: { any: true, goldPassed: true } });
    const out = proposeNextActions(state({ stage: "pre_proposal", proposal: gold, responseDueDate: days(2) }), NOW);
    expect(out[0]).toMatchObject({ kind: "submit", priority: "now" });
    expect(out.map((a) => a.kind)).not.toContain("at_risk");
  });

  it("at risk: due within 7 days before red team, or within 14 with no proposal", () => {
    const early = proposal({ stage: "pink_team" });
    const out = proposeNextActions(state({ stage: "pre_proposal", proposal: early, responseDueDate: days(5) }), NOW);
    expect(out[0]).toMatchObject({ kind: "at_risk", priority: "now" });
    expect(out[0]!.reason).toBe("Due in 5 days and the proposal is at pink team.");
    expect(kinds(state({ stage: "pre_proposal", proposal: proposal({ stage: "red_team" }), responseDueDate: days(5) }))).not.toContain("at_risk");
    expect(kinds(state({ stage: "qualification", responseDueDate: days(-1) }))).not.toContain("at_risk");
  });

  it("S6 Submitted: the outcome after the award date or 60 days, the debrief when lost", () => {
    const sub = proposal({ stage: "submitted", submittedAt: days(-10) });
    expect(kinds(state({ stage: "submitted", proposal: sub }))).toEqual([]);
    expect(kinds(state({ stage: "submitted", proposal: sub, awardDate: days(-1) }))).toEqual(["record_outcome"]);
    expect(kinds(state({ stage: "submitted", proposal: { ...sub, submittedAt: days(-61) } }))).toEqual(["record_outcome"]);
    expect(kinds(state({ stage: "lost", proposal: { ...sub, outcome: "lost" }, proposedLessons: 2 }))).toEqual(["hold_debrief", "confirm_lessons"]);
    expect(kinds(state({ stage: "won", proposal: { ...sub, outcome: "won" } }))).toEqual([]);
  });

  it("escalates priority from the due date and caps the ranked list in the sync", () => {
    const out = proposeNextActions(state({ responseDueDate: days(20), solicitation: { id: "s", parseStatus: "failed" } }), NOW);
    expect(out.find((a) => a.kind === "write_brief")?.priority).toBe("this_week");
    expect(out.find((a) => a.kind === "parse_solicitation")?.reason).toContain("last parse failed");
    expect(NEXT_ACTION_MAX).toBe(3);
  });
});

describe("reconcileNextActions", () => {
  const stored = (over: Partial<StoredNextAction>): StoredNextAction => ({
    id: "row1",
    kind: "score_evaluation",
    status: "proposed",
    stage: "identified",
    snoozedUntil: null,
    title: "Score the evaluation",
    reason: "No evaluation is saved; the five scores and the rollup are what the gate decision reads.",
    href: "/opportunities/opp1/evaluation",
    priority: "this_week",
    dueBy: days(40),
    ...over,
  });

  it("inserts what holds, refreshes an open row whose text changed, and leaves an unchanged one alone", () => {
    const rec = reconcileNextActions([stored({})], state(), NOW);
    expect(rec.insert.map((p) => p.kind)).toEqual(["write_brief"]);
    expect(rec.update).toEqual([]);
    expect(rec.close).toEqual([]);
    const changed = reconcileNextActions([stored({ priority: "later" })], state(), NOW);
    expect(changed.update).toEqual([{ id: "row1", patch: expect.objectContaining({ priority: "this_week" }) }]);
  });

  it("closes an open row as done when its done test passes, superseded otherwise", () => {
    const done = reconcileNextActions([stored({})], state({ evaluationSaved: true }), NOW);
    expect(done.close).toEqual([{ id: "row1", status: "done" }]);
    const moved = reconcileNextActions([stored({ kind: "gate_decision", title: "Take the bid / no-bid decision" })], state({ stage: "identified", responseDueDate: days(40) }), NOW);
    expect(moved.close).toEqual([{ id: "row1", status: "superseded" }]);
    const gateDone = reconcileNextActions([stored({ kind: "gate_decision", title: "Take the bid / no-bid decision" })], state({ stage: "qualification", incumbentRecorded: true, responseDueDate: days(90) }), NOW);
    expect(gateDone.close).toEqual([{ id: "row1", status: "done" }]);
  });

  it("a dismissal snoozes the rule at that stage until it lapses, and lifts when the stage changes", () => {
    const snoozed = stored({ status: "dismissed", snoozedUntil: days(5) });
    expect(reconcileNextActions([snoozed], state(), NOW).insert.map((p) => p.kind)).toEqual(["write_brief"]);
    expect(reconcileNextActions([stored({ status: "dismissed", snoozedUntil: days(-1) })], state(), NOW).insert.map((p) => p.kind)).toEqual(["score_evaluation", "write_brief"]);
    const other = { ...snoozed, kind: "record_incumbent", stage: "identified" };
    expect(reconcileNextActions([other], state({ stage: "qualification", responseDueDate: days(90) }), NOW).insert.map((p) => p.kind)).toEqual(["record_incumbent"]);
  });

  it("does not insert a second open row for the same kind", () => {
    const rec = reconcileNextActions([stored({}), stored({ id: "row2" })], state(), NOW);
    expect(rec.insert.map((p) => p.kind)).toEqual(["write_brief"]);
    expect(rec.close).toEqual([{ id: "row2", status: "superseded" }]);
  });
});

describe("rankOrgActions and the taken rate (5b)", () => {
  it("puts the reader's own pursuits first, then priority, due date and rule order", () => {
    const rows = [
      { id: "a", priority: "now" as const, dueBy: days(3), rule: "at_risk", ownerUserId: "other" },
      { id: "b", priority: "later" as const, dueBy: days(30), rule: "write_brief", ownerUserId: "me" },
      { id: "c", priority: "this_week" as const, dueBy: days(10), rule: "draft_sections", ownerUserId: "me" },
      { id: "d", priority: "this_week" as const, dueBy: days(10), rule: "map_compliance", ownerUserId: null },
    ];
    expect(rankOrgActions(rows, "me").map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
    expect(rankOrgActions(rows, "nobody").map((r) => r.id)).toEqual(["a", "c", "d", "b"]);
  });

  it("reports done over decided, and nothing until a person decided one", () => {
    expect(nextActionsTakenRate({ done: 0, dismissed: 0 })).toBeNull();
    expect(nextActionsTakenRate({ done: 3, dismissed: 1 })).toBe(0.75);
  });
});

describe("mayDecideNextAction", () => {
  it("allows the owner, Capture, Admin and superadmins only", () => {
    expect(mayDecideNextAction({ id: "u1", role: "author", isSuperadmin: false }, "u1")).toBe(true);
    expect(mayDecideNextAction({ id: "u2", role: "author", isSuperadmin: false }, "u1")).toBe(false);
    expect(mayDecideNextAction({ id: "u2", role: "capture", isSuperadmin: false }, "u1")).toBe(true);
    expect(mayDecideNextAction({ id: "u2", role: "admin", isSuperadmin: false }, null)).toBe(true);
    expect(mayDecideNextAction({ id: "u2", role: null, isSuperadmin: true }, null)).toBe(true);
    expect(mayDecideNextAction({ id: "u2", role: "viewer", isSuperadmin: false }, null)).toBe(false);
  });
});
