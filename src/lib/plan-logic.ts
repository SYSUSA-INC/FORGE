/**
 * BL-NAV-LIFECYCLE 4a — the Plan's pure rules: the roles, the RACI areas
 * and letters, the colour teams, how the solicitation's assignments seed
 * the team and stay in step with it, and what the plan still needs.
 * No database access; tested in tests/ai/plan-logic.test.ts.
 */
import type { OpportunityStage, PlanRaci, PlanRole } from "@/db/schema";
import type { SolicitationRole } from "@/db/schema";
import { SOLICITATION_ROLE_LABELS, SOLICITATION_ROLES } from "@/lib/solicitation-roles";

/** Plan lists stage Captured; Move to Develop (4c) moves it on. */
export const PLAN_LISTS_STAGE: OpportunityStage = "capture";

export const PLAN_ROLES: PlanRole[] = [...SOLICITATION_ROLES, "executive_sponsor", "contracts"];

export const PLAN_ROLE_LABELS: Record<PlanRole, string> = {
  ...SOLICITATION_ROLE_LABELS,
  executive_sponsor: "Executive sponsor",
  contracts: "Contracts",
};

/** The roles a plan shares with the solicitation's TeamPanel: one list, two views. */
export function isSharedRole(role: PlanRole): role is SolicitationRole {
  return (SOLICITATION_ROLES as string[]).includes(role);
}

export const RACI_AREAS = ["management", "technical", "past_performance", "pricing", "compliance", "production"] as const;
export type RaciArea = (typeof RACI_AREAS)[number];
export const RACI_AREA_LABELS: Record<RaciArea, string> = {
  management: "Management",
  technical: "Technical",
  past_performance: "Past performance",
  pricing: "Pricing",
  compliance: "Compliance",
  production: "Production",
};

export const RACI_LETTERS = ["R", "A", "C", "I"] as const;
export type RaciLetter = (typeof RACI_LETTERS)[number];
export const RACI_LETTER_LABELS: Record<RaciLetter, string> = {
  R: "Responsible",
  A: "Accountable",
  C: "Consulted",
  I: "Informed",
};

/** The four colour teams a plan names ahead of their round (green, the pricing review, is not planned here). */
export const PLAN_COLOR_TEAMS = ["pink", "red", "gold", "white_gloves"] as const;
export type PlanColorTeam = (typeof PLAN_COLOR_TEAMS)[number];
export const PLAN_COLOR_TEAM_LABELS: Record<PlanColorTeam, string> = {
  pink: "Pink team",
  red: "Red team",
  gold: "Gold team",
  white_gloves: "White Gloves",
};

export function isPlanRole(v: string): v is PlanRole {
  return (PLAN_ROLES as string[]).includes(v);
}
export function isRaciArea(v: string): v is RaciArea {
  return (RACI_AREAS as readonly string[]).includes(v);
}
export function isRaciLetter(v: string): v is RaciLetter {
  return (RACI_LETTERS as readonly string[]).includes(v);
}
export function isPlanColorTeam(v: string): v is PlanColorTeam {
  return (PLAN_COLOR_TEAMS as readonly string[]).includes(v);
}

/** Keeps only known areas with known letters, so a stored RACI is always clean. */
export function normalizeRaci(input: unknown): PlanRaci {
  const out: PlanRaci = {};
  if (!input || typeof input !== "object") return out;
  for (const [area, letter] of Object.entries(input as Record<string, unknown>)) {
    if (isRaciArea(area) && typeof letter === "string" && isRaciLetter(letter)) out[area] = letter;
  }
  return out;
}

/** Sets or clears one area's letter. */
export function withRaciLetter(raci: PlanRaci, area: RaciArea, letter: RaciLetter | null): PlanRaci {
  const next = normalizeRaci(raci);
  if (letter) next[area] = letter;
  else delete next[area];
  return next;
}

export type PlanRoleLike = {
  id: string;
  userId: string;
  role: PlanRole;
  colorTeam: string | null;
  raci: PlanRaci;
};

export type AssignmentLike = { userId: string; role: SolicitationRole; notes: string };

/**
 * The solicitation's assignments and the plan's shared roles are one list.
 * An assignment with no row on the plan is added (seeded); a plan row in a
 * shared role whose assignment is gone is removed. Colour-team reviewers
 * are compared per person: one assignment covers every colour row.
 * Executive sponsor and contracts live on the plan only.
 */
export function diffTeam(planRows: PlanRoleLike[], assignments: AssignmentLike[]): { toAdd: AssignmentLike[]; toRemoveIds: string[] } {
  const onPlan = new Set(planRows.filter((r) => isSharedRole(r.role)).map((r) => `${r.userId}:${r.role}`));
  const onSolicitation = new Set(assignments.map((a) => `${a.userId}:${a.role}`));
  const seen = new Set<string>();
  const toAdd = assignments.filter((a) => {
    const key = `${a.userId}:${a.role}`;
    if (seen.has(key) || onPlan.has(key)) return false;
    seen.add(key);
    return true;
  });
  const toRemoveIds = planRows.filter((r) => isSharedRole(r.role) && !onSolicitation.has(`${r.userId}:${r.role}`)).map((r) => r.id);
  return { toAdd, toRemoveIds };
}

export type PlanState = {
  people: number;
  /** Areas with an A (accountable) named. */
  accountable: RaciArea[];
  missingAccountable: RaciArea[];
  /** Members named per colour team. */
  colorTeams: Record<PlanColorTeam, number>;
  colorTeamsNamed: number;
};

export function planState(rows: PlanRoleLike[]): PlanState {
  const people = new Set(rows.map((r) => r.userId)).size;
  const accountable = RACI_AREAS.filter((area) => rows.some((r) => normalizeRaci(r.raci)[area] === "A"));
  const colorTeams = { pink: 0, red: 0, gold: 0, white_gloves: 0 } as Record<PlanColorTeam, number>;
  for (const r of rows) {
    if (r.role === "color_team_reviewer" && r.colorTeam && isPlanColorTeam(r.colorTeam)) colorTeams[r.colorTeam] += 1;
  }
  return {
    people,
    accountable,
    missingAccountable: RACI_AREAS.filter((a) => !accountable.includes(a)),
    colorTeams,
    colorTeamsNamed: PLAN_COLOR_TEAMS.filter((c) => colorTeams[c] > 0).length,
  };
}

export type PlanNextStep = "name_team" | "assign_raci" | "name_color_teams" | "plan_ready";

export const PLAN_NEXT_STEP_LABELS: Record<PlanNextStep, string> = {
  name_team: "Name the team",
  assign_raci: "Assign the RACI",
  name_color_teams: "Name the colour teams",
  plan_ready: "Open the plan",
};

/** The next thing the plan needs, in the order a proposal manager fills it. */
export function planNextStep(state: PlanState): PlanNextStep {
  if (state.people === 0) return "name_team";
  if (state.missingAccountable.length > 0) return "assign_raci";
  if (state.colorTeamsNamed < PLAN_COLOR_TEAMS.length) return "name_color_teams";
  return "plan_ready";
}

/** One line for the Pipeline → Plan row: "4 people · A for 2 of 6 areas · 1 of 4 colour teams". */
export function planStateLine(state: PlanState): string {
  return [
    `${state.people} ${state.people === 1 ? "person" : "people"}`,
    `A for ${state.accountable.length} of ${RACI_AREAS.length} areas`,
    `${state.colorTeamsNamed} of ${PLAN_COLOR_TEAMS.length} colour teams`,
  ].join(" · ");
}

/** Subject and body of the plan_role_assigned notification. */
export function planRoleAssignedMessage(input: {
  actorName: string;
  role: PlanRole;
  colorTeam: PlanColorTeam | null;
  opportunityTitle: string;
  notes: string;
}): { subject: string; body: string } {
  const what = input.colorTeam ? `${PLAN_COLOR_TEAM_LABELS[input.colorTeam]} reviewer` : PLAN_ROLE_LABELS[input.role];
  const title = input.opportunityTitle || "an opportunity";
  return {
    subject: `Named ${what} on the plan for ${title}`,
    body: `${input.actorName} named you ${what} on the plan for ${title}.` + (input.notes ? `\n\nNotes: ${input.notes}` : ""),
  };
}
