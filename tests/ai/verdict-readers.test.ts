/**
 * BL-AIX Phase 2c-1 review fixes — readers outside the loader respect the
 * team's verdicts: the amendment diff compares what each document says
 * and leaves rejected clauses out on both sides; the recompete radar's
 * scope leaves out clauses rejected anywhere on the opportunity.
 */
import { describe, expect, it } from "vitest";
import type { Solicitation } from "@/db/schema";
import { computeAmendmentDiff } from "@/lib/solicitation-amendment-diff";
import { requirementsText, withOpportunityVerdicts } from "@/lib/recompete-radar";
import { applyCorrections, type ReviewedRequirement } from "@/lib/requirement-review";
import { requirementKey } from "@/lib/requirements-text";

const at = new Date("2026-10-07T12:00:00Z");
const verdict = (text: string, action: "rejected" | "edited" | "confirmed", corrected = {}) => ({
  docKey: "",
  originalKey: requirementKey(text),
  action,
  corrected,
  original: {},
  userId: "u1",
  updatedAt: at,
});

const X = "Offerors shall provide a list of three past performance references.";
const P = "Volume I shall not exceed 25 pages.";
const B = "The contractor shall staff the help desk around the clock.";

const sol = (extractedRequirements: ReviewedRequirement[]): Solicitation =>
  ({ title: "RFP", agency: "", office: "", solicitationNumber: "", type: "rfp", naicsCode: "", setAside: "", responseDueDate: null, sectionLSummary: "", sectionMSummary: "", extractedRequirements }) as unknown as Solicitation;

describe("BL-AIX Phase 2c-1 review fixes — amendment diff", () => {
  it("leaves out a clause rejected on either side and ignores the team's edits", () => {
    const base = applyCorrections([{ kind: "shall", text: X, ref: "L.4" }, { kind: "shall", text: P, ref: "L.5" }, { kind: "shall", text: B, ref: "C.2" }] as ReviewedRequirement[], [
      verdict(X, "rejected"),
      verdict(P, "edited", { kind: "shall", text: "Volume I shall not exceed 30 pages.", ref: "L.5" }),
    ]);
    // The amendment repeats all three; the team confirmed them in bulk there.
    const amendment = applyCorrections([{ kind: "shall", text: X, ref: "L.4" }, { kind: "shall", text: P, ref: "L.5" }, { kind: "shall", text: B, ref: "C.2" }] as ReviewedRequirement[], [
      verdict(X, "confirmed"),
      verdict(P, "confirmed"),
      verdict(B, "confirmed"),
    ]);
    const diff = computeAmendmentDiff(sol(base), sol(amendment));
    expect(diff.summary).toMatchObject({ requirementsAdded: 0, requirementsRemoved: 0, requirementsModified: 0, requirementsUnchanged: 2 });
    expect(JSON.stringify(diff.requirementChanges)).not.toContain("past performance references");

    // Mirror: confirmed on the base, rejected on the amendment.
    const mirror = computeAmendmentDiff(sol(amendment), sol(base));
    expect(mirror.summary).toMatchObject({ requirementsAdded: 0, requirementsRemoved: 0, requirementsModified: 0, requirementsUnchanged: 2 });
  });
});

describe("BL-AIX Phase 2c-1 review fixes — recompete radar scope", () => {
  it("leaves out a clause rejected on another solicitation of the opportunity", () => {
    const base = { opportunityId: "opp-1", requirements: applyCorrections([{ kind: "shall", text: X, ref: "" }] as ReviewedRequirement[], [verdict(X, "rejected")]) };
    const amendment = { opportunityId: "opp-1", requirements: [{ kind: "shall", text: X, ref: "" }, { kind: "shall", text: B, ref: "" }] };
    const other = { opportunityId: "opp-2", requirements: [{ kind: "shall", text: X, ref: "" }] };
    const reviewed = withOpportunityVerdicts([amendment, base, other]);
    expect(requirementsText(reviewed.get(amendment))).toBe(B);
    expect(requirementsText(reviewed.get(other))).toBe(X);
    expect(requirementsText(base.requirements)).toBe("");
  });
});
