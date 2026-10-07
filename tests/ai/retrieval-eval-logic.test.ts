/**
 * BL-AIX Phase 1h-1 — scoring Brain retrieval against a tenant's own won
 * proposals: the queries, what counts as finding the winning text, and
 * the recall and MRR summary.
 */
import { describe, expect, it } from "vitest";
import { draftSourcesQuery } from "@/lib/citations";
import {
  firstRelevantRank,
  requirementsQuery,
  retrievalMisses,
  summarizeRetrieval,
  type RetrievalCaseResult,
} from "@/lib/retrieval-eval-logic";

const WINNING =
  "Our transition plan moves all forty legacy applications to the FedRAMP High environment in three reversible waves, each with a tested rollback that restores service within one hour, so the agency never loses mission continuity during the migration.";

describe("BL-AIX Phase 1h-1 — retrieval eval logic", () => {
  it("builds the drafter's query exactly as the drafter does, and a requirement-led one only with requirements", () => {
    expect(
      draftSourcesQuery({ sectionTitle: "Transition", sectionKind: "technical_approach", agency: "GSA", naicsCode: "541512", opportunityDescription: "Cloud migration", currentBodyPlain: "" }),
    ).toBe("Section: Transition (technical approach)\nAgency: GSA\nNAICS 541512\nOpportunity: Cloud migration");
    expect(requirementsQuery({ sectionTitle: "Transition", sectionKind: "technical", requirements: [] })).toBeNull();
    expect(requirementsQuery({ sectionTitle: "Transition", sectionKind: "technical", requirements: ["  Describe   the migration approach. ", ""] })).toBe(
      "Section: Transition (technical)\nRequirements:\n- Describe the migration approach.",
    );
  });

  it("finds the first hit that carries the winning text, not one that merely shares its topic", () => {
    const sameTopic = "We have migrated many legacy applications to FedRAMP environments for civilian agencies.";
    const carries = `Section 3. ${WINNING.slice(0, 160)} More text follows here.`;
    expect(firstRelevantRank([sameTopic, carries, WINNING], WINNING)).toBe(2);
    expect(firstRelevantRank([sameTopic], WINNING)).toBeNull();
    expect(firstRelevantRank([], WINNING)).toBeNull();
  });

  it("summarises recall at 1, 3 and 8 and MRR per mode, skipping failed cases and modes without a query", () => {
    const base = { proposalId: "p", proposalTitle: "P", sectionTitle: "S", sectionKind: "technical", hitsReturned: {} };
    const results: RetrievalCaseResult[] = [
      { ...base, sectionId: "a", ranks: { drafter: 1, requirements: 2 } },
      { ...base, sectionId: "b", ranks: { drafter: 4, requirements: null } },
      { ...base, sectionId: "c", ranks: { drafter: null } },
      { ...base, sectionId: "d", ranks: { drafter: 1 }, error: "boom" },
    ];
    const s = summarizeRetrieval(results);
    expect(s.drafter).toEqual({ cases: 3, recallAt1: 1 / 3, recallAt3: 1 / 3, recallAt8: 2 / 3, mrr: (1 + 0.25 + 0) / 3 });
    expect(s.requirements).toEqual({ cases: 2, recallAt1: 0, recallAt3: 0.5, recallAt8: 0.5, mrr: 0.25 });
    expect(retrievalMisses(results, "drafter").map((r) => r.sectionId)).toEqual(["c"]);
    expect(retrievalMisses(results, "requirements").map((r) => r.sectionId)).toEqual(["b"]);
    expect(summarizeRetrieval([])).toEqual({});
  });
});
