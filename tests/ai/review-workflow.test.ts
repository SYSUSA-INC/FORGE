/**
 * BL-FB-X-COLOR-TEAM — colour-team review workflow, pure parts: the
 * checklist templates and their hygiene, progress, section coverage,
 * and the consolidated comment report.
 */
import { describe, expect, it } from "vitest";
import { REVIEW_COLORS } from "@/lib/review-types";
import {
  CHECKLIST_LIMITS,
  SUMMARY_LIMITS,
  dueReminderDue,
  dueReminderSubject,
  heuristicSummary,
  sanitizeSummary,
  summaryMarkdown,
  REVIEW_CHECKLIST_TEMPLATES,
  checklistProgress,
  consolidateComments,
  consolidatedReport,
  describeCoverage,
  sanitizeChecklist,
  sectionCoverage,
  slugKey,
} from "@/lib/review-workflow-logic";

const SECTIONS = [
  { id: "s1", title: "Technical Approach", ordering: 1 },
  { id: "s2", title: "Management Approach", ordering: 2 },
  { id: "s3", title: "Past Performance", ordering: 3 },
];

describe("review workflow logic", () => {
  it("ships a checklist for every colour and cleans an edited one", () => {
    for (const c of REVIEW_COLORS) {
      const items = REVIEW_CHECKLIST_TEMPLATES[c.key];
      expect(items.length).toBeGreaterThanOrEqual(5);
      expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    }
    expect(REVIEW_CHECKLIST_TEMPLATES.green.map((i) => i.key)).toContain("boe_traceable");

    const cleaned = sanitizeChecklist([
      { key: "m_factors", label: "  Every Section M factor addressed  ", hint: " Look where the evaluator looks. " },
      "Claims carry proof",
      { key: "m_factors", label: "Duplicate key gets a fresh one" },
      { label: "" },
      42,
      { key: "Weird Key!", label: "x".repeat(200) },
    ]);
    expect(cleaned).toEqual([
      { key: "m_factors", label: "Every Section M factor addressed", hint: "Look where the evaluator looks." },
      { key: "claims_carry_proof_2", label: "Claims carry proof" },
      { key: "duplicate_key_gets_a_fresh_one_3", label: "Duplicate key gets a fresh one" },
      { key: "weird_key_", label: "x".repeat(CHECKLIST_LIMITS.maxLabelChars) },
    ]);
    expect(sanitizeChecklist(Array.from({ length: 30 }, (_, i) => `Line ${i}`))!.length).toBe(CHECKLIST_LIMITS.maxItems);
    expect(sanitizeChecklist("not a list")).toBeNull();
    expect(sanitizeChecklist(undefined)).toBeNull();
    expect(slugKey("API Gateway!", 3)).toBe("api_gateway_3");
  });

  it("counts checklist progress per reviewer, ignoring stray keys", () => {
    const tick = (userId: string, itemKey: string, checked = true) => ({ userId, itemKey, checked });
    const p = checklistProgress(
      REVIEW_CHECKLIST_TEMPLATES.gold,
      [tick("u1", "exec_summary"), tick("u1", "consistency"), tick("u1", "themes_land", false), tick("u2", "exec_summary"), tick("u2", "removed_line"), tick("ghost", "exec_summary")],
      ["u1", "u2"],
    );
    expect(p).toEqual({ total: 5, done: 3, of: 10, perReviewer: [{ userId: "u1", done: 2, total: 5 }, { userId: "u2", done: 1, total: 5 }] });
  });

  it("works out who covers which section, with whole-proposal reviewers covering all", () => {
    const cov = sectionCoverage({
      sections: SECTIONS,
      reviewerIds: ["lead", "ana"],
      sectionAssignments: [
        { userId: "ana", sectionId: "s1" },
        { userId: "ana", sectionId: "s3" },
        { userId: "left_the_round", sectionId: "s2" },
      ],
    });
    expect(cov.wholeProposalReviewerIds).toEqual(["lead"]);
    expect(cov.bySection).toEqual([
      { sectionId: "s1", reviewerIds: ["lead", "ana"] },
      { sectionId: "s2", reviewerIds: ["lead"] },
      { sectionId: "s3", reviewerIds: ["lead", "ana"] },
    ]);
    expect(cov.uncovered).toEqual([]);
    expect(describeCoverage(cov)).toBe("All 3 sections covered");

    const scopedOnly = sectionCoverage({
      sections: SECTIONS,
      reviewerIds: ["ana"],
      sectionAssignments: [{ userId: "ana", sectionId: "s3" }],
    });
    expect(scopedOnly.uncovered).toEqual(["s1", "s2"]);
    expect(describeCoverage(scopedOnly)).toBe("2 of 3 sections have no reviewer");
    expect(describeCoverage(sectionCoverage({ sections: [], reviewerIds: ["ana"], sectionAssignments: [] }))).toBe("No sections yet");
  });

  it("consolidates comments by section and writes the hand-off report", () => {
    const groups = consolidateComments(SECTIONS, [
      { id: "c3", sectionId: "s3", body: "Add the contract number.", resolved: false, authorName: "Ana", createdAt: "2026-10-03T10:02:00Z" },
      { id: "c1", sectionId: "s1", body: "Where is the\n  incumbent?", resolved: false, authorName: null, createdAt: "2026-10-03T10:00:00Z" },
      { id: "c2", sectionId: "s1", body: "Already fixed.", resolved: true, authorName: "Bo", createdAt: "2026-10-03T10:01:00Z" },
      { id: "c4", sectionId: null, body: "Strong overall.", resolved: false, authorName: "Ana", createdAt: "2026-10-03T10:03:00Z" },
      { id: "c5", sectionId: "gone", body: "Orphaned section comment.", resolved: false, authorName: "Bo", createdAt: "2026-10-03T10:04:00Z" },
    ]);
    expect(groups.map((g) => [g.sectionId, g.title, g.open.length, g.resolved.length, g.authors])).toEqual([
      ["s1", "Technical Approach", 1, 1, ["FORGE AI", "Bo"]],
      ["s3", "Past Performance", 1, 0, ["Ana"]],
      [null, "General", 2, 0, ["Ana", "Bo"]],
    ]);

    const report = consolidatedReport({
      proposalTitle: "NOAA Fisheries IT Support",
      colorLabel: "Red Team",
      dueDate: "10/10/2026",
      instructions: "Score Factor 2 as the evaluator would.\nIgnore formatting.",
      groups,
      sectionNumbers: new Map(SECTIONS.map((s) => [s.id, s.ordering])),
      verdicts: [
        { name: "Ana", verdict: "Conditional", summary: "Fix PP." },
        { name: "Bo", verdict: null },
      ],
      checklist: { total: 7, done: 9, of: 14, perReviewer: [] },
    });
    expect(report.split("\n")).toEqual([
      "# Red Team — NOAA Fisheries IT Support",
      "Due 10/10/2026",
      "",
      "> Score Factor 2 as the evaluator would.",
      "> Ignore formatting.",
      "",
      "**4 open comments** · 1 resolved",
      "Checklist: 9/14 ticks across reviewers",
      "",
      "## Verdicts",
      "- Ana: Conditional — Fix PP.",
      "- Bo: pending",
      "",
      "## §1 Technical Approach",
      "1 open · 1 resolved · FORGE AI, Bo",
      "- [ ] Where is the incumbent? — FORGE AI",
      "- [x] Already fixed. — Bo",
      "",
      "## §3 Past Performance",
      "1 open · 0 resolved · Ana",
      "- [ ] Add the contract number. — Ana",
      "",
      "## General",
      "2 open · 0 resolved · Ana, Bo",
      "- [ ] Strong overall. — Ana",
      "- [ ] Orphaned section comment. — Bo",
    ]);
    expect(consolidateComments(SECTIONS, [])).toEqual([]);
  });
});

describe("review workflow logic — Slice 2 follow-ups", () => {
  const groups = consolidateComments(SECTIONS, [
    { id: "c1", sectionId: "s1", body: "Where is the incumbent?", resolved: false, authorName: null, createdAt: "2026-10-03T10:00:00Z" },
    { id: "c2", sectionId: "s1", body: "Cite the PWS paragraph.", resolved: false, authorName: "Ana", createdAt: "2026-10-03T10:01:00Z" },
    { id: "c3", sectionId: "s3", body: "Strong past performance story — keep it.", resolved: false, authorName: "Bo", createdAt: "2026-10-03T10:02:00Z" },
    { id: "c4", sectionId: "s2", body: "Done.", resolved: true, authorName: "Bo", createdAt: "2026-10-03T10:03:00Z" },
  ]);

  it("cleans the model's debrief and refuses an empty one", () => {
    const s = sanitizeSummary(
      {
        headline: "  Red Team leaves the technical volume short on proof.  ",
        themes: [{ title: "Proof", detail: "Claims lack contract numbers.", sections: ["Technical Approach", 42] }, { title: "", detail: "dropped" }],
        mustFix: ["Name the incumbent", "", 7],
        strengths: "not a list",
        nextSteps: Array.from({ length: 12 }, (_, i) => `step ${i}`),
      },
      { fallback: false, model: "m" },
    );
    expect(s).toEqual({
      headline: "Red Team leaves the technical volume short on proof.",
      themes: [{ title: "Proof", detail: "Claims lack contract numbers.", sections: ["Technical Approach"] }],
      mustFix: ["Name the incumbent"],
      strengths: [],
      nextSteps: Array.from({ length: SUMMARY_LIMITS.maxItems }, (_, i) => `step ${i}`),
      fallback: false,
      model: "m",
    });
    expect(sanitizeSummary({ headline: "", themes: [], mustFix: [] }, { fallback: false, model: "m" })).toBeNull();
    expect(sanitizeSummary(null, { fallback: false, model: "m" })).toBeNull();
  });

  it("writes the heuristic debrief from the comments themselves", () => {
    const s = heuristicSummary({
      colorLabel: "Red Team",
      groups,
      verdicts: [{ name: "Ana", verdict: "Conditional" }, { name: "Bo", verdict: null }],
      checklist: { total: 7, done: 5, of: 14, perReviewer: [] },
      uncheckedLabels: ["Claims carry proof"],
      sectionNumbers: new Map(SECTIONS.map((s) => [s.id, s.ordering])),
    });
    expect(s.headline).toBe("Red Team: 3 open comments across 2 sections, 1 resolved, 1 conditional.");
    expect(s.themes.map((t) => t.title)).toEqual(["§1 Technical Approach needs the most work", "§3 Past Performance needs the most work"]);
    expect(s.mustFix).toEqual(["§1 Technical Approach: Where is the incumbent?", "§1 Technical Approach: Cite the PWS paragraph.", "§3 Past Performance: Strong past performance story — keep it."]);
    expect(s.strengths).toEqual(["Strong past performance story — keep it."]);
    expect(s.nextSteps).toEqual(["Checklist still open: Claims carry proof", "Finish the checklist (5/14 ticks).", "1 reviewer still to submit a verdict."]);
    expect(s.fallback).toBe(true);
    expect(summaryMarkdown(s).split("\n").slice(0, 4)).toEqual([`**${s.headline}**`, "", "## Themes", "- **§1 Technical Approach needs the most work** — 2 open comments from FORGE AI, Ana. (Technical Approach)"]);
    expect(summaryMarkdown(s)).toContain("- [ ] §1 Technical Approach: Where is the incumbent?");
  });

  it("knows when the day-before reminder is due", () => {
    const now = new Date("2026-10-03T08:00:00Z");
    expect(dueReminderDue(now, null)).toBe(false);
    expect(dueReminderDue(now, new Date("2026-10-05T08:00:00Z"))).toBe(false);
    expect(dueReminderDue(now, new Date("2026-10-04T07:00:00Z"))).toBe(true);
    expect(dueReminderDue(now, new Date("2026-10-01T00:00:00Z"))).toBe(true);
    expect(dueReminderSubject("Red Team", "NOAA IT", new Date("2026-10-04T07:00:00Z"), now)).toBe("Red Team review of NOAA IT is due tomorrow — your verdict is still open");
    expect(dueReminderSubject("Red Team", "NOAA IT", new Date("2026-10-01T00:00:00Z"), now)).toBe("Red Team review of NOAA IT is overdue — your verdict is still open");
  });
});
