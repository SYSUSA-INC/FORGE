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

export const solicitations: Solicitation[] = [
  {
    id: "SOL-0094",
    number: "N00024-25-R-0094",
    title: "Shipboard AI-Enabled Decision Support Services",
    agency: "DEPT OF NAVY / NAVSEA",
    naics: "541512",
    setAside: "SB",
    type: "RFP",
    contractType: "FFP + T&M",
    postedAt: "2026-03-18",
    dueAt: "2026-04-29 14:00 EST",
    bidDecision: "BID",
    pWin: 62,
    value: "$48M",
    ceilingK: 48000,
    requirementCount: 214,
    amendments: 4,
  },
  {
    id: "SOL-1178",
    number: "W56KGY-26-R-1178",
    title: "Battalion Mission Command Sustainment (BMCS)",
    agency: "US ARMY / PEO C3T",
    naics: "541330",
    setAside: "8(a)",
    type: "RFP",
    contractType: "Cost-Plus",
    postedAt: "2026-03-30",
    dueAt: "2026-05-14 17:00 EST",
    bidDecision: "REVIEW",
    pWin: 41,
    value: "$112M",
    ceilingK: 112000,
    requirementCount: 338,
    amendments: 1,
  },
  {
    id: "SOL-2203",
    number: "SSQ-26-I-2203",
    title: "Sources Sought — Zero Trust Architecture Integration",
    agency: "DEPT OF STATE / CIO",
    naics: "541519",
    setAside: "—",
    type: "SOURCES_SOUGHT",
    contractType: "TBD",
    postedAt: "2026-04-01",
    dueAt: "2026-04-22 12:00 EST",
    bidDecision: "REVIEW",
    pWin: 28,
    value: "TBD",
    ceilingK: 0,
    requirementCount: 42,
    amendments: 0,
  },
  {
    id: "SOL-7781",
    number: "GSA-26-Q-7781",
    title: "Agency-Wide Data Platform Modernization",
    agency: "GSA / FAS",
    naics: "541512",
    setAside: "WOSB",
    type: "RFQ",
    contractType: "FFP",
    postedAt: "2026-03-22",
    dueAt: "2026-04-19 16:00 EST",
    bidDecision: "BID",
    pWin: 71,
    value: "$18M",
    ceilingK: 18000,
    requirementCount: 96,
    amendments: 2,
  },
  {
    id: "SOL-3456",
    number: "HHS-26-R-3456",
    title: "Public Health Analytics Platform (PHAP)",
    agency: "HHS / CDC",
    naics: "541511",
    setAside: "—",
    type: "RFP",
    contractType: "FFP",
    postedAt: "2026-02-27",
    dueAt: "2026-05-03 15:00 EST",
    bidDecision: "NO_BID",
    pWin: 12,
    value: "$7.4M",
    ceilingK: 7400,
    requirementCount: 128,
    amendments: 0,
  },
];

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

export const proposals: Proposal[] = [
  {
    id: "FRG-0042",
    code: "FRG-0042",
    title: "NAVSEA AI Decision Support · Response",
    solicitation: "N00024-25-R-0094",
    agency: "DEPT OF NAVY / NAVSEA",
    status: "DRAFTING",
    captureManager: "J. Calder",
    proposalManager: "A. Okafor",
    dueAt: "2026-04-29 14:00 EST",
    daysLeft: 12,
    progress: 58,
    aiPct: 41,
    pagesEstimated: 184,
    pagesLimit: 200,
    compliancePct: 76,
  },
  {
    id: "FRG-0039",
    code: "FRG-0039",
    title: "GSA Data Platform Modernization · Response",
    solicitation: "GSA-26-Q-7781",
    agency: "GSA / FAS",
    status: "PINK_TEAM",
    captureManager: "M. Reyes",
    proposalManager: "S. Iqbal",
    dueAt: "2026-04-19 16:00 EST",
    daysLeft: 2,
    progress: 82,
    aiPct: 37,
    pagesEstimated: 96,
    pagesLimit: 100,
    compliancePct: 91,
  },
  {
    id: "FRG-0035",
    code: "FRG-0035",
    title: "ARMY BMCS · Technical Volume",
    solicitation: "W56KGY-26-R-1178",
    agency: "US ARMY / PEO C3T",
    status: "OUTLINING",
    captureManager: "P. Hollis",
    proposalManager: "T. Nakamura",
    dueAt: "2026-05-14 17:00 EST",
    daysLeft: 27,
    progress: 14,
    aiPct: 8,
    pagesEstimated: 42,
    pagesLimit: 250,
    compliancePct: 22,
  },
  {
    id: "FRG-0031",
    code: "FRG-0031",
    title: "State Dept ZTA · Sources Sought",
    solicitation: "SSQ-26-I-2203",
    agency: "DEPT OF STATE / CIO",
    status: "FINAL_REVIEW",
    captureManager: "J. Calder",
    proposalManager: "L. Vasquez",
    dueAt: "2026-04-22 12:00 EST",
    daysLeft: 5,
    progress: 97,
    aiPct: 22,
    pagesEstimated: 18,
    pagesLimit: 20,
    compliancePct: 100,
  },
];

export type Requirement = {
  id: string;
  ref: string;
  text: string;
  category: "MANDATORY" | "DESIRED" | "INFORMATIONAL";
  section: string;
  compliance: "NOT_ADDRESSED" | "PARTIALLY" | "FULLY" | "VERIFIED" | "NON_COMPLIANT" | "N/A";
  assignee: string;
};

export const requirements: Requirement[] = [
  {
    id: "R-001",
    ref: "L.5.2.1",
    text: "Offeror shall describe approach to integrating AI/ML models with shipboard C5ISR systems, including latency, fail-safe, and human-on-the-loop design.",
    category: "MANDATORY",
    section: "3.2.1 AI Integration Approach",
    compliance: "FULLY",
    assignee: "A. Okafor",
  },
  {
    id: "R-002",
    ref: "L.5.2.2",
    text: "Offeror shall provide cybersecurity approach compliant with DoD Zero Trust Reference Architecture v2.0 and NIST SP 800-207.",
    category: "MANDATORY",
    section: "3.4 Cybersecurity",
    compliance: "PARTIALLY",
    assignee: "K. Park",
  },
  {
    id: "R-003",
    ref: "L.5.3.1",
    text: "Proposal should describe past performance within the last 5 years of contracts ≥ $20M with DoD customers.",
    category: "DESIRED",
    section: "Vol III · Past Performance",
    compliance: "FULLY",
    assignee: "R. Singh",
  },
  {
    id: "R-004",
    ref: "L.6.1",
    text: "Offeror shall submit Technical Volume not exceeding 150 pages, 12-point Times New Roman, 1-inch margins.",
    category: "MANDATORY",
    section: "Formatting Constraints",
    compliance: "VERIFIED",
    assignee: "S. Iqbal",
  },
  {
    id: "R-005",
    ref: "M.3.1(a)",
    text: "Government will evaluate the degree to which the Offeror's AI governance plan mitigates model drift and adversarial risk.",
    category: "MANDATORY",
    section: "3.2.3 Model Governance",
    compliance: "NOT_ADDRESSED",
    assignee: "Unassigned",
  },
  {
    id: "R-006",
    ref: "L.5.4",
    text: "Offeror may propose optional training curriculum for government personnel.",
    category: "INFORMATIONAL",
    section: "4.1 Training (Optional)",
    compliance: "N/A",
    assignee: "—",
  },
  {
    id: "R-007",
    ref: "L.5.2.4",
    text: "Offeror shall demonstrate plan to achieve Authority to Operate (ATO) within 120 days of award.",
    category: "MANDATORY",
    section: "3.4.2 ATO Plan",
    compliance: "PARTIALLY",
    assignee: "K. Park",
  },
  {
    id: "R-008",
    ref: "L.5.2.5",
    text: "Offeror shall identify Key Personnel including Program Manager and Chief Engineer with clearances at SECRET or higher.",
    category: "MANDATORY",
    section: "Vol II · Management",
    compliance: "FULLY",
    assignee: "M. Reyes",
  },
];

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

export const sections: Section[] = [
  { id: "s-1", number: "1.0", title: "Executive Summary", volume: "Vol I", assignee: "A. Okafor", status: "DRAFTING", wordCount: 1240, pageEstimate: 4, aiPct: 55 },
  { id: "s-2", number: "2.0", title: "Understanding of the Mission", volume: "Vol I", assignee: "A. Okafor", status: "READY", wordCount: 3210, pageEstimate: 11, aiPct: 40 },
  { id: "s-3", number: "3.0", title: "Technical Approach", volume: "Vol I", assignee: "K. Park", status: "DRAFTING", wordCount: 15400, pageEstimate: 54, aiPct: 48 },
  { id: "s-4", number: "3.1", title: "Systems Engineering", volume: "Vol I", assignee: "D. Liang", status: "READY", wordCount: 4810, pageEstimate: 17, aiPct: 36 },
  { id: "s-5", number: "3.2", title: "AI Integration Approach", volume: "Vol I", assignee: "A. Okafor", status: "DRAFTING", wordCount: 6120, pageEstimate: 21, aiPct: 61 },
  { id: "s-6", number: "3.4", title: "Cybersecurity & ATO", volume: "Vol I", assignee: "K. Park", status: "IN_REVIEW", wordCount: 5490, pageEstimate: 19, aiPct: 28 },
  { id: "s-7", number: "4.0", title: "Management Approach", volume: "Vol II", assignee: "M. Reyes", status: "READY", wordCount: 7210, pageEstimate: 24, aiPct: 33 },
  { id: "s-8", number: "5.0", title: "Past Performance", volume: "Vol III", assignee: "R. Singh", status: "ASSIGNED", wordCount: 2140, pageEstimate: 8, aiPct: 15 },
];

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

export const kb: KBItem[] = [
  { id: "KB-001", kind: "PAST_PERFORMANCE", title: "USN LCS Mission Package Sustainment", meta: "FFP · $38M · 2022–2025 · CPARS Exceptional", tags: ["NAVSEA", "C5ISR", "FFP"], reuse: 34, embedding: "0.92", updated: "2 DAYS" },
  { id: "KB-002", kind: "CAPABILITY", title: "Zero Trust Architecture Implementation", meta: "NIST 800-207 · Okta + Illumio + Zscaler", tags: ["ZTA", "CYBER", "NIST"], reuse: 82, embedding: "0.88", updated: "6H" },
  { id: "KB-003", kind: "PERSONNEL", title: "Dr. Helene Bray — Chief AI Scientist", meta: "TS/SCI · PhD MIT CSAIL · 18 YOE", tags: ["AI", "ML", "TS/SCI"], reuse: 19, embedding: "0.79", updated: "1W" },
  { id: "KB-004", kind: "BOILERPLATE", title: "Corporate Quality Management — ISO 9001:2015", meta: "Last third-party audit 2025-08-11", tags: ["QMS", "ISO"], reuse: 142, embedding: "0.71", updated: "3W" },
  { id: "KB-005", kind: "PAST_PERFORMANCE", title: "US Army FORGE Battle Command Migration", meta: "IDIQ TO · $54M · 2021–2024 · CPARS Very Good", tags: ["ARMY", "BMC", "IDIQ"], reuse: 27, embedding: "0.85", updated: "12D" },
  { id: "KB-006", kind: "CAPABILITY", title: "Federal Data Platform on AWS GovCloud", meta: "Databricks + Glue + IL-5 boundary", tags: ["AWS", "GOVCLOUD", "DATA"], reuse: 66, embedding: "0.83", updated: "3D" },
  { id: "KB-007", kind: "PERSONNEL", title: "Col. (Ret.) Marcus Reyes — PMP", meta: "Secret · 24 YOE Army PEO · DAWIA III", tags: ["PM", "ARMY"], reuse: 41, embedding: "0.80", updated: "5D" },
  { id: "KB-008", kind: "BOILERPLATE", title: "CMMI Level 3 Appraisal Narrative", meta: "SEI appraisal ID A-45821", tags: ["CMMI", "QMS"], reuse: 98, embedding: "0.69", updated: "2M" },
];

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

export const reviewComments: ReviewComment[] = [
  { id: "C-1041", cycle: "PINK", reviewer: "A. Brahms", severity: "CRITICAL", section: "3.2 AI Integration", anchor: "¶14", comment: "No mention of human-on-the-loop control loop per L.5.2.1 — gov will flag non-compliance.", resolved: false, age: "2h" },
  { id: "C-1042", cycle: "PINK", reviewer: "S. Doran", severity: "MAJOR", section: "3.4 Cybersecurity", anchor: "¶7", comment: "Cite specific 800-207 ZTA pillars. Current text is too generic.", resolved: false, age: "3h" },
  { id: "C-1043", cycle: "PINK", reviewer: "A. Brahms", severity: "MINOR", section: "1.0 Exec Summary", anchor: "¶2", comment: "Win theme #2 repeats phrasing from #1. Differentiate.", resolved: true, age: "5h" },
  { id: "C-1044", cycle: "PINK", reviewer: "M. Koenig", severity: "CRITICAL", section: "Vol III PP#2", anchor: "Block 6", comment: "Contract number mismatch with CPARS — verify W91QUZ-19-C-0042 vs -0024.", resolved: false, age: "7h" },
  { id: "C-1045", cycle: "PINK", reviewer: "S. Doran", severity: "SUGGESTION", section: "4.0 Mgmt", anchor: "Fig 4-2", comment: "Consider swim-lane instead of box diagram — easier for evaluator.", resolved: false, age: "1d" },
  { id: "C-1046", cycle: "PINK", reviewer: "A. Brahms", severity: "MAJOR", section: "3.2.3 Governance", anchor: "missing", comment: "Section not yet drafted — referenced by Sec M.3.1(a).", resolved: false, age: "1d" },
];
