/**
 * BL-FB-SOL-AMEND-DIFF — compute a structured diff between two parsed
 * solicitations (typically a base solicitation and its amendment).
 *
 * The diff covers:
 *   - Top-level fields the parse extracts (title, agency, due date,
 *     NAICS, set-aside, Section L/M summaries, etc.)
 *   - The extracted-requirements list, matched best-effort by
 *     normalized text similarity.
 *
 * Requirements matching:
 *   - Each "before" item is paired with the "after" item that has the
 *     most-similar text (Jaccard over normalized word sets) above a
 *     threshold (default 0.55).
 *   - Pairs at similarity = 1.0 are "unchanged".
 *   - Pairs below 1.0 are "modified" — both items returned for
 *     side-by-side display.
 *   - "before" items with no match are "removed".
 *   - "after" items with no match are "added".
 */

import type { Solicitation } from "@/db/schema";

type Req = { kind: string; text: string; ref: string };

export type ScalarFieldDiff = {
  field: keyof BaseLevelComparable;
  label: string;
  before: string;
  after: string;
  /** "unchanged" when before === after, "modified" otherwise. */
  status: "unchanged" | "modified";
};

export type RequirementDiff = {
  status: "unchanged" | "added" | "removed" | "modified";
  before: Req | null;
  after: Req | null;
  /** Similarity score used to match (0–1). Always 1 for unchanged. */
  similarity: number;
};

export type AmendmentDiff = {
  fieldChanges: ScalarFieldDiff[];
  requirementChanges: RequirementDiff[];
  summary: {
    fieldsChanged: number;
    requirementsAdded: number;
    requirementsRemoved: number;
    requirementsModified: number;
    requirementsUnchanged: number;
  };
};

type BaseLevelComparable = {
  title: string;
  agency: string;
  office: string;
  solicitationNumber: string;
  type: string;
  naicsCode: string;
  setAside: string;
  responseDueDate: string;
  sectionLSummary: string;
  sectionMSummary: string;
};

const FIELD_LABELS: Record<keyof BaseLevelComparable, string> = {
  title: "Title",
  agency: "Agency",
  office: "Office",
  solicitationNumber: "Solicitation #",
  type: "Type",
  naicsCode: "NAICS",
  setAside: "Set-aside",
  responseDueDate: "Due date",
  sectionLSummary: "Section L summary",
  sectionMSummary: "Section M summary",
};

function projectComparable(s: Solicitation): BaseLevelComparable {
  return {
    title: s.title ?? "",
    agency: s.agency ?? "",
    office: s.office ?? "",
    solicitationNumber: s.solicitationNumber ?? "",
    type: s.type ?? "",
    naicsCode: s.naicsCode ?? "",
    setAside: s.setAside ?? "",
    responseDueDate: s.responseDueDate
      ? s.responseDueDate.toISOString().slice(0, 10)
      : "",
    sectionLSummary: s.sectionLSummary ?? "",
    sectionMSummary: s.sectionMSummary ?? "",
  };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersect = 0;
  for (const v of a) if (b.has(v)) intersect += 1;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

const MATCH_THRESHOLD = 0.55;

export function computeAmendmentDiff(
  base: Solicitation,
  amendment: Solicitation,
): AmendmentDiff {
  // Scalar field diffs.
  const beforeFields = projectComparable(base);
  const afterFields = projectComparable(amendment);
  const fieldChanges: ScalarFieldDiff[] = (
    Object.keys(beforeFields) as (keyof BaseLevelComparable)[]
  )
    .map((key) => {
      const before = beforeFields[key];
      const after = afterFields[key];
      return {
        field: key,
        label: FIELD_LABELS[key],
        before,
        after,
        status: before === after ? ("unchanged" as const) : ("modified" as const),
      };
    });

  // Requirements diff — pair best matches above threshold.
  const beforeReqs = (base.extractedRequirements ?? []) as Req[];
  const afterReqs = (amendment.extractedRequirements ?? []) as Req[];
  const afterTokens = afterReqs.map((r) => tokenize(r.text));
  const beforeTokens = beforeReqs.map((r) => tokenize(r.text));

  const usedAfter = new Set<number>();
  const requirementChanges: RequirementDiff[] = [];

  for (let i = 0; i < beforeReqs.length; i++) {
    const beforeReq = beforeReqs[i]!;
    let bestIdx = -1;
    let bestScore = 0;
    for (let j = 0; j < afterReqs.length; j++) {
      if (usedAfter.has(j)) continue;
      const score = jaccard(beforeTokens[i]!, afterTokens[j]!);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0 && bestScore >= MATCH_THRESHOLD) {
      usedAfter.add(bestIdx);
      const afterReq = afterReqs[bestIdx]!;
      const identical =
        beforeReq.text === afterReq.text &&
        beforeReq.kind === afterReq.kind &&
        beforeReq.ref === afterReq.ref;
      requirementChanges.push({
        status: identical ? "unchanged" : "modified",
        before: beforeReq,
        after: afterReq,
        similarity: bestScore,
      });
    } else {
      requirementChanges.push({
        status: "removed",
        before: beforeReq,
        after: null,
        similarity: 0,
      });
    }
  }

  // Anything left unmatched on the after side is new.
  for (let j = 0; j < afterReqs.length; j++) {
    if (usedAfter.has(j)) continue;
    requirementChanges.push({
      status: "added",
      before: null,
      after: afterReqs[j]!,
      similarity: 0,
    });
  }

  const summary = {
    fieldsChanged: fieldChanges.filter((f) => f.status === "modified").length,
    requirementsAdded: requirementChanges.filter((r) => r.status === "added")
      .length,
    requirementsRemoved: requirementChanges.filter(
      (r) => r.status === "removed",
    ).length,
    requirementsModified: requirementChanges.filter(
      (r) => r.status === "modified",
    ).length,
    requirementsUnchanged: requirementChanges.filter(
      (r) => r.status === "unchanged",
    ).length,
  };

  return { fieldChanges, requirementChanges, summary };
}
