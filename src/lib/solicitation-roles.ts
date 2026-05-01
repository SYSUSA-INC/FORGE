import type { SolicitationRole } from "@/db/schema";

export const SOLICITATION_ROLE_LABELS: Record<SolicitationRole, string> = {
  capture_lead: "Capture lead",
  proposal_manager: "Proposal manager",
  technical_lead: "Technical lead",
  pricing_lead: "Pricing lead",
  compliance_reviewer: "Compliance reviewer",
  color_team_reviewer: "Color-team reviewer",
  subject_matter_expert: "Subject-matter expert",
  contributor: "Contributor",
  observer: "Observer",
};

export const SOLICITATION_ROLES: SolicitationRole[] = [
  "capture_lead",
  "proposal_manager",
  "technical_lead",
  "pricing_lead",
  "compliance_reviewer",
  "color_team_reviewer",
  "subject_matter_expert",
  "contributor",
  "observer",
];
