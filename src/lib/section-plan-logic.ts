/**
 * BL-NAV-LIFECYCLE 4b-2 (P-4) — the parts' pure rules: when a section
 * counts as drafted, when it is overdue, the count the plan's state
 * shows, and the wording of proposal_section_assigned and
 * proposal_section_overdue. No database access; tested in
 * tests/ai/section-plan-logic.test.ts.
 */
import type { ProposalSectionStatus } from "@/db/schema";
import { daysBetween } from "@/lib/milestone-logic";

export type SectionDraftLike = { status: ProposalSectionStatus; content: string; wordCount: number };

/** A part has a draft once it left not_started and something is written. */
export function sectionHasDraft(s: SectionDraftLike): boolean {
  if (s.status === "not_started") return false;
  return s.content.trim().length > 0 || s.wordCount > 0;
}

/** Past its due date with no draft: what the daily cron tells the owner about. */
export function isSectionOverdue(input: { todayIso: string; dueDate: string | null; draft: SectionDraftLike }): boolean {
  if (!input.dueDate) return false;
  return daysBetween(input.todayIso, input.dueDate) < 0 && !sectionHasDraft(input.draft);
}

export type PartLike = { authorUserId: string | null; dueDate: string | null };

export type PartsCount = {
  /** Sections across the opportunity's proposals. */
  total: number;
  /** Sections with an owner. */
  owned: number;
  /** Sections with a due date. */
  dated: number;
};

export const NO_PARTS: PartsCount = { total: 0, owned: 0, dated: 0 };

export function partsCount(parts: PartLike[]): PartsCount {
  return {
    total: parts.length,
    owned: parts.filter((p) => !!p.authorUserId).length,
    dated: parts.filter((p) => !!p.dueDate).length,
  };
}

/** Subject and body of proposal_section_assigned; the date rides along when the part has one. */
export function sectionAssignedMessage(input: { sectionTitle: string; byName: string; dueDate: string | null }): { subject: string; body: string } {
  const title = input.sectionTitle || "Untitled section";
  return {
    subject: `You were assigned "${title}"`,
    body: `${input.byName || "A teammate"} assigned you the "${title}" section.${input.dueDate ? ` It is due ${input.dueDate}.` : ""} Open the section editor to start drafting.`,
  };
}

/** Subject and body of proposal_section_overdue, sent once per part per due date. */
export function sectionOverdueMessage(input: { sectionTitle: string; proposalTitle: string; dueDate: string; todayIso: string }): { subject: string; body: string } {
  const late = -daysBetween(input.todayIso, input.dueDate);
  const title = input.sectionTitle || "Untitled section";
  const proposal = input.proposalTitle || "a proposal";
  return {
    subject: `Overdue: ${title.slice(0, 80)} — ${proposal.slice(0, 80)}`,
    body: `The "${title}" section of ${proposal} was due ${input.dueDate} (${late === 1 ? "yesterday" : `${late} days ago`}) and has no draft yet. Open the section editor to start it, or ask the proposal manager to move the date.`,
  };
}
