/**
 * BL-STAB-9 — what the AI document review (BL-23) builds on.
 *
 * The review used to ask one AI answer to re-extract the requirements,
 * Sections L and M and the evaluation factors from a 100,000-character
 * excerpt, inside a 4,000-token output limit. A real RFP does not fit,
 * so the answer was cut off part-way through the requirement list. The
 * parse already reads the whole document for requirements (BL-STAB-1),
 * structures Sections L and M (BL-AIX 2b), and the team verifies the
 * list (BL-AIX 2c). The review now takes all of that from the parse and
 * asks the AI only for judgement: a summary, the period and place of
 * performance, certifications and the questions it would ask.
 *
 * Requirement ids are derived from the wording intake produced
 * (`reviewKeyOf`), the identity verdicts and the compliance seed use, so
 * the same clause keeps its id across a re-parse or a reorder and the
 * capability matrix can score it again by id.
 *
 * Pure: no DB, unit-tested.
 */
import { createHash } from "node:crypto";
import type { SolicitationReviewResult } from "@/db/schema";
import { activeRequirements, reviewKeyOf, type ReviewedRequirement } from "@/lib/requirement-review";
import { basisLabel, type LmStructure } from "@/lib/solicitation-lm";

export type ReviewRequirement = SolicitationReviewResult["requirements"][number];
export type ReviewFactor = SolicitationReviewResult["evaluationFactors"][number];

export type ReviewBasis = {
  requirements: ReviewRequirement[];
  sectionL: string[];
  sectionM: string[];
  evaluationFactors: ReviewFactor[];
  capabilityAreas: string[];
  /** Changes when the requirements or the evaluation factors change. */
  hash: string;
};

function sha(text: string, length: number): string {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

/** A requirement's id: the same for the same extracted wording. */
export function requirementIdOf(r: ReviewedRequirement): string {
  return `req_${sha(reviewKeyOf(r), 12)}`;
}

/** The matrix's grouping for a requirement: the part of the document that states it. */
export function capabilityAreaOf(r: ReviewedRequirement): string {
  const section = r.source?.section?.trim() ?? "";
  if (!section) return "";
  if (/^[A-Z]$/.test(section)) {
    if (section === "L") return "Section L (instructions)";
    if (section === "M") return "Section M (evaluation)";
    return `Section ${section}`;
  }
  return section.slice(0, 60);
}

function lines(text: string, max: number): string[] {
  return text
    .split(/\n+|(?<=[.;])\s+(?=[A-Z(•\-–])/)
    .map((l) => l.replace(/^[\s•\-–*]+/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, max);
}

function sectionLLines(lm: LmStructure, summary: string): string[] {
  const l = lm.sectionL;
  if (!l) return lines(summary, 12);
  const out: string[] = [];
  for (const v of l.volumes) {
    const limit = v.pageLimit !== null ? `${v.pageLimit} pages` : v.pageLimitText || "no page limit stated";
    out.push(`${v.name}: ${limit}${v.contents ? ` — ${v.contents}` : ""}`);
  }
  for (const r of l.formatRules) out.push(r.rule);
  for (const r of l.submission) out.push(r.rule);
  return out.filter(Boolean).slice(0, 30);
}

function sectionMLines(lm: LmStructure, summary: string): string[] {
  const m = lm.sectionM;
  if (!m) return lines(summary, 12);
  const out: string[] = [`Basis for award: ${basisLabel(m.basis)}.`];
  if (m.relativeImportance) out.push(m.relativeImportance);
  for (const f of m.factors) out.push(f.importance ? `${f.name} — ${f.importance}` : f.name);
  return out.filter(Boolean).slice(0, 30);
}

function factorsOf(lm: LmStructure): ReviewFactor[] {
  return (lm.sectionM?.factors ?? []).map((f) => ({
    name: f.name,
    weight: f.importance,
    notes: f.subfactors.length > 0 ? `Subfactors: ${f.subfactors.map((s) => (s.importance ? `${s.name} (${s.importance})` : s.name)).join("; ")}` : "",
  }));
}

/**
 * The review's requirements, Sections L and M and evaluation factors from
 * the parse: the team-verified requirement list (rejected clauses left
 * out) and the structured Sections L and M, falling back to the parse's
 * L and M summaries when the sections were not structured.
 */
export function buildReviewBasis(input: {
  requirements: ReviewedRequirement[];
  lm: LmStructure;
  sectionLSummary: string;
  sectionMSummary: string;
}): ReviewBasis {
  const seen = new Map<string, number>();
  const requirements: ReviewRequirement[] = activeRequirements(input.requirements).map((r) => {
    const base = requirementIdOf(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      id: n === 1 ? base : `${base}_${n}`,
      kind: r.kind,
      text: r.text,
      sectionRef: r.ref,
      capabilityArea: capabilityAreaOf(r),
    };
  });
  const evaluationFactors = factorsOf(input.lm);
  const capabilityAreas = [...new Set(requirements.map((r) => r.capabilityArea).filter(Boolean))];
  const hash = sha(
    JSON.stringify([requirements.map((r) => [r.id, r.kind, r.text, r.sectionRef]), evaluationFactors.map((f) => [f.name, f.weight])]),
    16,
  );
  return {
    requirements,
    sectionL: sectionLLines(input.lm, input.sectionLSummary),
    sectionM: sectionMLines(input.lm, input.sectionMSummary),
    evaluationFactors,
    capabilityAreas,
    hash,
  };
}

export type ReviewFreshness = "current" | "stale" | "legacy";

/**
 * Whether a stored review still matches the parse: "legacy" for a review
 * made before it was built on the parse, "stale" when the requirements or
 * evaluation factors changed since (a re-parse, an amendment, a verdict).
 */
export function reviewFreshness(result: Pick<SolicitationReviewResult, "basis"> | null | undefined, currentHash: string): ReviewFreshness {
  const stored = result?.basis?.hash;
  if (!stored) return "legacy";
  return stored === currentHash ? "current" : "stale";
}

/** The requirement ids a matrix has not scored yet, in the review's order. */
export function unscoredRequirementIds(requirements: { id: string }[], cells: { requirementId: string }[]): string[] {
  const scored = new Set(cells.map((c) => c.requirementId));
  return requirements.map((r) => r.id).filter((id) => !scored.has(id));
}
