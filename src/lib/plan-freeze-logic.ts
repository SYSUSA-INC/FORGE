/**
 * BL-NAV-LIFECYCLE 4c-2 — the freeze (P-7) and Move to Develop (P-8): what
 * a change after the freeze is worth writing to the Activity, what stands
 * between a plan and Develop, and the note the move leaves. Pure; tested in
 * tests/ai/plan-freeze-logic.test.ts.
 */
import type { OpportunityStage } from "@/db/schema";
import { agreementBlocker } from "@/lib/plan-charter-logic";
import { RACI_AREA_LABELS, type PlanState } from "@/lib/plan-logic";

/** Where Move to Develop takes the opportunity (Develop lists "Pre-proposal"); Plan lists the stage before it. */
export const DEVELOP_STAGE: OpportunityStage = "pre_proposal";
/** The stage Plan works on (Capture's Move to Plan puts the opportunity here). */
export const PLAN_STAGE_OPEN: OpportunityStage = "capture";

export type FrozenState = { matrix: boolean; outline: boolean };
export const NOT_FROZEN: FrozenState = { matrix: false, outline: false };

export function frozenState(plan: { complianceMatrixFrozenAt: Date | string | null; outlineFrozenAt: Date | string | null } | null | undefined): FrozenState {
  return { matrix: !!plan?.complianceMatrixFrozenAt, outline: !!plan?.outlineFrozenAt };
}

export function isFrozen(f: FrozenState): boolean {
  return f.matrix && f.outline;
}

/**
 * The compliance fields whose change moves the matrix itself: what is
 * required, where it is mapped. Status, notes and owner are the work of
 * Develop and would drown the Red team's view, so they are not noted.
 */
export const MATERIAL_COMPLIANCE_FIELDS = ["category", "number", "requirementText", "volume", "rfpPageReference", "proposalSectionId"] as const;

export function isMaterialComplianceChange(fields: readonly string[]): boolean {
  return fields.some((f) => (MATERIAL_COMPLIANCE_FIELDS as readonly string[]).includes(f));
}

export type FrozenChange =
  | { area: "matrix"; action: "added" | "changed" | "removed" | "imported" | "remapped"; label: string; count?: number; fields?: string[] }
  | { area: "outline"; action: "added" | "renamed" | "removed" | "rebuilt"; label: string; count?: number };

const FIELD_LABELS: Record<string, string> = {
  category: "category",
  number: "number",
  requirementText: "requirement text",
  volume: "volume",
  rfpPageReference: "RFP page",
  proposalSectionId: "mapped section",
};

/** The Activity row a change after the freeze leaves, so the Red team sees what moved. */
export function frozenChangeNote(c: FrozenChange, frozenAtIso: string): { title: string; body: string } {
  const since = `Frozen ${frozenAtIso.slice(0, 10)}.`;
  const n = c.count ?? 1;
  if (c.area === "matrix") {
    const what =
      c.action === "added" ? `Requirement added: ${c.label}`
      : c.action === "removed" ? `Requirement removed: ${c.label}`
      : c.action === "imported" ? `${n} requirement${n === 1 ? "" : "s"} imported`
      : c.action === "remapped" ? `${n} requirement${n === 1 ? "" : "s"} mapped to sections`
      : `Requirement changed (${(c.fields ?? []).filter((f) => f in FIELD_LABELS).map((f) => FIELD_LABELS[f]).join(", ") || "details"}): ${c.label}`;
    return { title: "Compliance matrix changed after the freeze", body: `${what.slice(0, 400)}. ${since}` };
  }
  const what =
    c.action === "added" ? `Section added: ${c.label}`
    : c.action === "removed" ? `Section removed: ${c.label}`
    : c.action === "renamed" ? `Section renamed: ${c.label}`
    : `Outline rebuilt from Section L (${n} section${n === 1 ? "" : "s"})`;
  return { title: "Outline changed after the freeze", body: `${what.slice(0, 400)}. ${since}` };
}

/** What stands between this plan and Develop; empty when Move to Develop is open. */
export function developBlockers(input: { stage: OpportunityStage; state: PlanState; frozen: FrozenState; isPartner: boolean; agreementStatus: string }): string[] {
  const out: string[] = [];
  if (input.stage !== PLAN_STAGE_OPEN) out.push("Only an opportunity in Plan (Captured) moves to Develop from here.");
  const missing = input.state.missingAccountable;
  if (missing.length > 0) out.push(`Name an A (accountable) for ${missing.map((a) => RACI_AREA_LABELS[a]).join(", ")}.`);
  if (input.state.charter !== "signed") out.push("Sign the charter.");
  if (input.state.milestones === 0) out.push("Build the schedule: no milestones yet.");
  if (!input.frozen.matrix) out.push("Freeze the compliance matrix.");
  if (!input.frozen.outline) out.push("Freeze the outline.");
  const agreement = agreementBlocker(input.isPartner, input.agreementStatus);
  if (agreement) out.push(agreement);
  return out;
}

/** The activity note Move to Develop leaves. */
export function developNote(input: { isPartner: boolean; milestones: number }): string {
  return `Moved to Develop. The plan is signed off: team and RACI named, charter signed, ${input.milestones} milestone${input.milestones === 1 ? "" : "s"} set, compliance matrix and outline frozen${input.isPartner ? ", teaming agreement signed" : ""}.`;
}
