/**
 * BL-SCOUT-LEARN — the learning loop's pure parts: how far an outcome got
 * sets its weight, the cold-start and cap guards, affinity from the nearest
 * examples, and the exploration slice.
 */
import { describe, expect, it } from "vitest";
import {
  affinityFor,
  applyLearning,
  buildLearningExamples,
  learningLine,
  learningState,
  noGoWeight,
  withoutLearnedSignal,
  WEIGHTS,
  type LearnExample,
  type LearnSources,
} from "@/lib/scout-learn";

const D = (iso: string) => new Date(iso);
const empty: LearnSources = { finds: [], opportunities: [], decisions: [], outcomes: [], resetAt: null };
const opp = (id: string, stage: string, title = `Opp ${id}`) => ({ id, title, agency: "VA", description: "Cloud migration support services", stage, at: D("2026-10-01") });
const ex = (weight: number, name = "X", why = "which you took to Go"): LearnExample => ({ key: name, text: name + " text", name, weight, why, at: null });

describe("buildLearningExamples — weights by how far it got", () => {
  const weightOf = (src: Partial<LearnSources>, id = "a") => buildLearningExamples({ ...empty, ...src }).find((e) => e.key === `opp:${id}`)?.weight;

  it("won is strongest, lost-after-pursuit a weak positive", () => {
    expect(weightOf({ opportunities: [opp("a", "won")] })).toBe(WEIGHTS.won);
    expect(weightOf({ opportunities: [opp("a", "writing")], outcomes: [{ opportunityId: "a", outcome: "lost", at: null }] })).toBe(WEIGHTS.lost);
    expect(weightOf({ opportunities: [opp("a", "submitted")], outcomes: [{ opportunityId: "a", outcome: "won", at: null }] })).toBe(WEIGHTS.won);
  });

  it("go, partner and plan decisions are positive, partner and plan stronger", () => {
    const d = (decision: string) => ({ decisions: [{ opportunityId: "a", decision, reasonCategory: "", at: D("2026-10-02") }], opportunities: [opp("a", "qualification")] });
    expect(weightOf(d("go"))).toBe(WEIGHTS.go);
    expect(weightOf(d("partner"))).toBe(WEIGHTS.partnerOrPlan);
    expect(weightOf(d("plan"))).toBe(WEIGHTS.partnerOrPlan);
    expect(WEIGHTS.partnerOrPlan).toBeGreaterThan(WEIGHTS.go);
  });

  it("a scope No-Go is the strongest negative; timing, teaming and set-aside No-Gos only weakly negative", () => {
    const nogo = (reasonCategory: string) => weightOf({ opportunities: [opp("a", "no_bid")], decisions: [{ opportunityId: "a", decision: "no_go", reasonCategory, at: D("2026-10-02") }] })!;
    expect(nogo("scope")).toBe(-1);
    for (const weak of ["timing", "relationship", "compliance"]) expect(nogo(weak)).toBeGreaterThan(-0.2);
    expect(nogo("scope")).toBeLessThan(nogo("capacity"));
    expect(nogo("capacity")).toBeLessThan(nogo("timing"));
    expect(noGoWeight("something-new")).toBeLessThan(0);
  });

  it("the latest decision wins: a No-Go later reversed to Go is positive", () => {
    const w = weightOf({
      opportunities: [opp("a", "qualification")],
      decisions: [
        { opportunityId: "a", decision: "no_go", reasonCategory: "scope", at: D("2026-10-01") },
        { opportunityId: "a", decision: "go", reasonCategory: "", at: D("2026-10-05") },
      ],
    });
    expect(w).toBe(WEIGHTS.go);
  });

  it("an opportunity that reached Capture counts without a decision; an untouched manual one is no example", () => {
    expect(weightOf({ opportunities: [opp("a", "capture")] })).toBe(WEIGHTS.capture);
    expect(weightOf({ opportunities: [opp("a", "identified")] })).toBeUndefined();
    expect(weightOf({ opportunities: [opp("a", "identified")], finds: [{ id: "f", title: "t", agency: "", description: "d", status: "imported", opportunityId: "a", at: null }] })).toBe(WEIGHTS.imported);
  });

  it("a dismissed find is negative; an import is read through its opportunity, not twice", () => {
    const out = buildLearningExamples({
      ...empty,
      finds: [
        { id: "d", title: "Janitorial", agency: "GSA", description: "Cleaning services", status: "dismissed", opportunityId: null, at: D("2026-10-03") },
        { id: "i", title: "Cloud", agency: "VA", description: "Cloud migration", status: "imported", opportunityId: "a", at: D("2026-10-03") },
      ],
      opportunities: [opp("a", "capture", "Cloud")],
    });
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.key === "find:d")!.weight).toBe(WEIGHTS.dismissed);
    expect(out.find((e) => e.key === "opp:a")!.weight).toBe(WEIGHTS.capture);
  });

  it("a reset hides everything at or before it, and anything undated", () => {
    const src = { ...empty, opportunities: [{ ...opp("a", "won"), at: D("2026-10-01") }, { ...opp("b", "won"), at: D("2026-10-20") }, { ...opp("c", "won"), at: null }], resetAt: D("2026-10-10") };
    expect(buildLearningExamples(src).map((e) => e.key)).toEqual(["opp:b"]);
  });
});

describe("learningState — the guards", () => {
  const set = (pos: number, neg: number) => [...Array.from({ length: pos }, () => ex(1)), ...Array.from({ length: neg }, () => ex(-1))];
  it("is off below 20 labelled outcomes, or with fewer than 5 positive", () => {
    expect(learningState(set(5, 14), true)).toMatchObject({ mode: "waiting", cap: 0, labelled: 19 });
    expect(learningState(set(4, 30), true)).toMatchObject({ mode: "waiting", cap: 0 });
  });
  it("is capped at ±5 from 20 to 49, and ±10 from 50", () => {
    expect(learningState(set(5, 15), true)).toMatchObject({ mode: "early", cap: 5, labelled: 20 });
    expect(learningState(set(20, 29), true)).toMatchObject({ mode: "early", cap: 5 });
    expect(learningState(set(20, 30), true)).toMatchObject({ mode: "full", cap: 10 });
  });
  it("is off when an admin switched it off, whatever the history", () => {
    expect(learningState(set(30, 30), false)).toMatchObject({ mode: "disabled", cap: 0 });
  });
  it("says what it still needs, and how many it learns from", () => {
    expect(learningLine(learningState(set(2, 3), true))).toContain("not learning from outcomes yet: 5 so far");
    expect(learningLine(learningState(set(2, 3), true))).toContain("15 more decided finds");
    expect(learningLine(learningState(set(20, 30), true))).toContain("Learning from 50 outcomes");
    expect(learningLine(learningState(set(30, 0), false))).toContain("switched off");
  });
});

describe("affinityFor — nearest neighbours, bounded", () => {
  const goVec = [1, 0];
  const noVec = [0, 1];
  const examples = [ex(1, "Cloud migration", "which you took to Go"), ex(-1, "Janitorial", "which you marked No-Go (scope isn't ours)")];
  const vecs = [goVec, noVec];

  it("a find like a Go example is raised, like a No-Go lowered, by at most the cap", () => {
    const up = affinityFor([1, 0.05], examples, vecs, 10);
    expect(up.adjustment).toBeGreaterThan(5);
    expect(up.adjustment).toBeLessThanOrEqual(10);
    expect(up.basis).toBe("Similar to “Cloud migration”, which you took to Go");
    const down = affinityFor([0.05, 1], examples, vecs, 10);
    expect(down.adjustment).toBeLessThan(-5);
    expect(down.adjustment).toBeGreaterThanOrEqual(-10);
    expect(down.basis).toContain("Janitorial");
    expect(affinityFor([1, 0], examples, vecs, 5).adjustment).toBeLessThanOrEqual(5);
  });
  it("resembling nothing is no adjustment and not 'resembles'", () => {
    expect(affinityFor([-0.7, -0.7], examples, vecs, 10)).toEqual({ adjustment: 0, resembles: false, basis: "" });
  });
  it("a find between a Go and a No-Go example is pulled less than either", () => {
    const mid = affinityFor([0.7071, 0.7071], examples, vecs, 10);
    expect(Math.abs(mid.adjustment)).toBeLessThan(2);
  });
});

describe("applyLearning — nothing hides, weak is left alone, the exploration slice stays in view", () => {
  const on = { mode: "full" as const, cap: 10, labelled: 60, positives: 30, negatives: 30 };
  const examples = [ex(1, "Cloud migration"), ex(-1, "Janitorial", "which you marked No-Go (scope isn't ours)")];
  const vecs = [[1, 0], [0, 1]];

  it("changes nothing while it is not acting", () => {
    const r = applyLearning([{ vec: [1, 0], band: "related", score: 50 }], examples, vecs, { ...on, mode: "waiting", cap: 0 });
    expect(r[0]).toEqual({ affinity: null, signal: null, score: 50 });
  });
  it("adjusts a Related find within the cap, keeps it on the list and says why", () => {
    const [down, up] = applyLearning([{ vec: [0.05, 1], band: "related", score: 50 }, { vec: [1, 0.05], band: "related", score: 50 }], examples, vecs, on);
    expect(down!.score).toBeGreaterThanOrEqual(40);
    expect(down!.score).toBeLessThan(50);
    expect(up!.score).toBeLessThanOrEqual(60);
    expect(up!.signal).toMatch(/^Learned: \+\d+\. Similar to “Cloud migration”, which you took to Go$/);
  });
  it("never raises or lowers a Weak find", () => {
    expect(applyLearning([{ vec: [1, 0], band: "weak", score: 10 }], examples, vecs, on)[0]).toEqual({ affinity: null, signal: null, score: 10 });
  });
  it("lifts the best three Related finds that resemble nothing, and only those", () => {
    const items = [10, 20, 30, 40].map((score) => ({ vec: [-0.7, -0.7], band: "related" as const, score }));
    const r = applyLearning([...items, { vec: [-0.7, -0.7], band: "strong", score: 80 }], examples, vecs, on);
    expect(r.map((x) => x.score)).toEqual([10, 25, 35, 45, 80]);
    expect(r[1]!.signal).toContain("New line of work");
    expect(r[0]!.signal).toBeNull();
    expect(r[4]!.signal).toBeNull();
  });
  it("keeps scores within 0..100", () => {
    expect(applyLearning([{ vec: [1, 0.05], band: "strong", score: 98 }], examples, vecs, on)[0]!.score).toBe(100);
    expect(applyLearning([{ vec: [0.05, 1], band: "related", score: 2 }], examples, vecs, on)[0]!.score).toBe(0);
  });
  it("strips only its own line when re-scoring", () => {
    expect(withoutLearnedSignal(["Cloud", "Learned: +4. Similar to “X”, which you won"])).toEqual(["Cloud"]);
  });
});
