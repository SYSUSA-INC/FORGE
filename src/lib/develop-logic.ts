/**
 * BL-NAV-LIFECYCLE 5a (FORGE II D-1, D-3) — Develop's pure rules: who
 * leads the draft from the plan's team, what "ready for Pink" needs, the
 * state line and the next step on Pipeline → Develop. No database access;
 * tested in tests/ai/develop-logic.test.ts.
 */
import { normalizeRaci } from "@/lib/plan-logic";
import { sectionHasDraft, type SectionDraftLike } from "@/lib/section-plan-logic";

export type TeamRow = { userId: string; role: string; raci: unknown };

export type DraftLeads = {
  proposalManagerUserId: string | null;
  captureManagerUserId: string | null;
  pricingLeadUserId: string | null;
};

/**
 * The three leads from the plan's team: the proposal manager is the one in
 * that role, else whoever holds the A for management; the capture manager
 * and the pricing lead are the people in those roles. The first named wins.
 */
export function leadsFromTeam(team: TeamRow[]): DraftLeads {
  const byRole = (role: string) => team.find((t) => t.role === role)?.userId ?? null;
  const manager = byRole("proposal_manager") ?? team.find((t) => normalizeRaci(t.raci).management === "A")?.userId ?? null;
  return { proposalManagerUserId: manager, captureManagerUserId: byRole("capture_lead"), pricingLeadUserId: byRole("pricing_lead") };
}

export type DraftSection = SectionDraftLike & { title: string };
export type DraftRequirement = { mapped: boolean };

export type Readiness = {
  ready: boolean;
  /** What is missing, in the order the manager fixes it; empty when ready. */
  missing: string[];
  sectionsTotal: number;
  sectionsDrafted: number;
  requirementsTotal: number;
  requirementsMapped: number;
};

/**
 * Ready for Pink (D-3): every section past not_started with words written,
 * and every requirement mapped to a section. Advisory only: starting a
 * round early stays possible. The pre-flight read runs when the round
 * starts (it is metered AI), so it is not a rule here.
 */
export function readiness(sections: DraftSection[], requirements: DraftRequirement[]): Readiness {
  const undrafted = sections.filter((s) => !sectionHasDraft(s));
  const unmapped = requirements.filter((r) => !r.mapped).length;
  const missing: string[] = [];
  if (sections.length === 0) missing.push("The proposal has no sections yet.");
  else if (undrafted.length > 0) {
    const names = undrafted.slice(0, 3).map((s) => s.title || "Untitled section");
    const more = undrafted.length > 3 ? ` and ${undrafted.length - 3} more` : "";
    missing.push(`${undrafted.length} of ${sections.length} ${sections.length === 1 ? "section" : "sections"} ${undrafted.length === 1 ? "has" : "have"} no draft yet: ${names.join(", ")}${more}.`);
  }
  if (unmapped > 0) missing.push(`${unmapped} of ${requirements.length} ${requirements.length === 1 ? "requirement" : "requirements"} ${unmapped === 1 ? "is" : "are"} not mapped to a section.`);
  return {
    ready: missing.length === 0,
    missing,
    sectionsTotal: sections.length,
    sectionsDrafted: sections.length - undrafted.length,
    requirementsTotal: requirements.length,
    requirementsMapped: requirements.length - unmapped,
  };
}

export type DevelopState = {
  hasProposal: boolean;
  readiness: Readiness;
  /** The newest review round: its colour, status and date (ISO day), or null. */
  nextReview: { color: string; status: string; date: string | null } | null;
};

export const NO_READINESS: Readiness = { ready: false, missing: [], sectionsTotal: 0, sectionsDrafted: 0, requirementsTotal: 0, requirementsMapped: 0 };

export type DevelopNextStep = "create_draft" | "write_sections" | "map_requirements" | "start_pink" | "run_review";

export const DEVELOP_NEXT_STEP_LABELS: Record<DevelopNextStep, string> = {
  create_draft: "Create a Draft",
  write_sections: "Write the sections",
  map_requirements: "Map the requirements",
  start_pink: "Start Pink review",
  run_review: "Open the review",
};

export function developNextStep(state: DevelopState): DevelopNextStep {
  if (!state.hasProposal) return "create_draft";
  if (state.nextReview && state.nextReview.status !== "complete") return "run_review";
  if (state.readiness.sectionsDrafted < state.readiness.sectionsTotal || state.readiness.sectionsTotal === 0) return "write_sections";
  if (state.readiness.requirementsMapped < state.readiness.requirementsTotal) return "map_requirements";
  return "start_pink";
}

/** One line for the Pipeline → Develop row: "3 of 8 sections drafted · 12 of 20 requirements mapped · Pink review 2026-12-01". */
export function developStateLine(state: DevelopState): string {
  if (!state.hasProposal) return "No draft yet";
  const r = state.readiness;
  return [
    `${r.sectionsDrafted} of ${r.sectionsTotal} ${r.sectionsTotal === 1 ? "section" : "sections"} drafted`,
    r.requirementsTotal > 0 ? `${r.requirementsMapped} of ${r.requirementsTotal} requirements mapped` : "no requirements",
    state.nextReview ? `${state.nextReview.color === "white_gloves" ? "White gloves" : state.nextReview.color[0]!.toUpperCase() + state.nextReview.color.slice(1)} review${state.nextReview.date ? ` ${state.nextReview.date}` : ""}` : r.ready ? "ready for Pink" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
