export type Solicitation = {
  id: string;
  number: string;
  title: string;
  agency: string;
  naics: string;
  setAside: string;
  type: "RFP" | "RFI" | "RFQ" | "SOURCES_SOUGHT";
  contractType: string;
  postedAt: string;
  dueAt: string;
  bidDecision: "BID" | "NO_BID" | "REVIEW";
  pWin: number;
  value: string;
  ceilingK: number;
  requirementCount: number;
  amendments: number;
};

export const solicitations: Solicitation[] = [];

export type Proposal = {
  id: string;
  code: string;
  title: string;
  solicitation: string;
  agency: string;
  status:
    | "PLANNING"
    | "OUTLINING"
    | "DRAFTING"
    | "PINK_TEAM"
    | "REVISING"
    | "RED_TEAM"
    | "GOLD_TEAM"
    | "FINAL_REVIEW"
    | "PRODUCTION"
    | "SUBMITTED";
  captureManager: string;
  proposalManager: string;
  dueAt: string;
  daysLeft: number;
  progress: number;
  aiPct: number;
  pagesEstimated: number;
  pagesLimit: number;
  compliancePct: number;
};

export const proposals: Proposal[] = [];

export type Requirement = {
  id: string;
  ref: string;
  text: string;
  category: "MANDATORY" | "DESIRED" | "INFORMATIONAL";
  section: string;
  compliance: "NOT_ADDRESSED" | "PARTIALLY" | "FULLY" | "VERIFIED" | "NON_COMPLIANT" | "N/A";
  assignee: string;
};

export const requirements: Requirement[] = [];

export type Section = {
  id: string;
  number: string;
  title: string;
  volume: string;
  assignee: string;
  status: "ASSIGNED" | "DRAFTING" | "READY" | "IN_REVIEW";
  wordCount: number;
  pageEstimate: number;
  aiPct: number;
};

export const sections: Section[] = [];

export type KBItem = {
  id: string;
  kind: "CAPABILITY" | "PAST_PERFORMANCE" | "PERSONNEL" | "BOILERPLATE";
  title: string;
  meta: string;
  tags: string[];
  reuse: number;
  embedding: string;
  updated: string;
};

export const kb: KBItem[] = [];

export type ReviewComment = {
  id: string;
  cycle: "PINK" | "RED" | "GOLD";
  reviewer: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR" | "SUGGESTION";
  section: string;
  anchor: string;
  comment: string;
  resolved: boolean;
  age: string;
};

export const reviewComments: ReviewComment[] = [];
