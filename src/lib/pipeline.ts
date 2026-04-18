export type PipelineStageKey =
  | "S1_IDENTIFIED"
  | "S2_SOURCES_SOUGHT"
  | "S3_POSITIONING"
  | "S4_QUALIFICATION"
  | "S5_CAPTURE"
  | "S6_PRE_PROPOSAL"
  | "S7_WRITING"
  | "S8_SUBMITTED";

export type PipelineStage = {
  key: PipelineStageKey;
  label: string;
  count: number;
  valueLow: number;
  valueHigh: number;
  description: string;
  checklist: string[];
};

export const pipelineStages: PipelineStage[] = [
  {
    key: "S1_IDENTIFIED",
    label: "Identified Opportunity",
    count: 12,
    valueLow: 0,
    valueHigh: 0,
    description:
      "Watchlist items from SAM.gov, GovWin, agency forecasts, and partner intel. Not yet qualified.",
    checklist: [
      "Does it match our NAICS set?",
      "Is the agency / buying office a known customer?",
      "Is the estimated value within our target range?",
      "Is there a known incumbent?",
    ],
  },
  {
    key: "S2_SOURCES_SOUGHT",
    label: "Sources Sought / RFI",
    count: 7,
    valueLow: 0,
    valueHigh: 0,
    description:
      "Pre-solicitation market research. Shape requirements early and establish positioning.",
    checklist: [
      "Have we drafted a capability statement?",
      "Have we attended the industry day?",
      "Have we requested a 1:1 with the buying office?",
      "Are we tracking amendments to the RFI?",
    ],
  },
  {
    key: "S3_POSITIONING",
    label: "Identification & Positioning",
    count: 57,
    valueLow: 91_787_181,
    valueHigh: 104_145_170,
    description:
      "Confirm alignment to mission, budget, and competitive landscape. Begin capture planning.",
    checklist: [
      "Do we have an executive sponsor?",
      "Have we met with at least one decision-maker?",
      "Do we have a differentiated win theme draft?",
      "Have we identified key teaming partners?",
    ],
  },
  {
    key: "S4_QUALIFICATION",
    label: "Qualification (Pursue / No Pursue)",
    count: 521,
    valueLow: 0,
    valueHigh: 3_000_000_000,
    description:
      "Formal bid / no-bid decision. Confirm pricing strategy, teaming, and past performance fit.",
    checklist: [
      "Is our Q&A complete?",
      "Are we set apart from our competitors?",
      "Is our tech/management approach appropriate?",
      "Is our pricing strategy appropriate?",
      "Is customer receptive to our approach?",
      "Have we determined an appropriate project manager?",
      "Where needed, do we have subcontractor agreements?",
      "Do we have a good past performance record?",
      "Have we conducted a Pursue/No Pursue Tollgate?",
    ],
  },
  {
    key: "S5_CAPTURE",
    label: "Capture Development — Bid Active",
    count: 10,
    valueLow: 0,
    valueHigh: 0,
    description:
      "Active capture. Proposal kickoff, outline, and color-team schedule confirmed.",
    checklist: [
      "Has the proposal kickoff been held?",
      "Is the proposal calendar locked?",
      "Are Volume leads assigned?",
      "Are all Section L/M requirements mapped?",
    ],
  },
  {
    key: "S6_PRE_PROPOSAL",
    label: "Pre-Proposal / Draft Proposal",
    count: 11,
    valueLow: 3_676_826,
    valueHigh: 3_676_826,
    description:
      "Outline, mock-ups, and storyboards in progress; Pink Team prep underway.",
    checklist: [
      "Are all storyboards complete?",
      "Is the compliance matrix baseline locked?",
      "Has the first full-draft milestone shipped?",
      "Is Pink Team reviewer panel confirmed?",
    ],
  },
  {
    key: "S7_WRITING",
    label: "Writing the Proposal",
    count: 51,
    valueLow: 1_000_000,
    valueHigh: 2_000_000,
    description:
      "Active drafting through Pink / Red / Gold reviews. AI-assisted generation and revision.",
    checklist: [
      "Has Pink Team been completed and addressed?",
      "Is Red Team scheduled and staffed?",
      "Are all graphics and tables locked?",
      "Has the price volume been cross-checked?",
    ],
  },
  {
    key: "S8_SUBMITTED",
    label: "Proposal Submitted",
    count: 152,
    valueLow: 12_768_540,
    valueHigh: 32_866_040,
    description:
      "Awaiting award, debrief, or protest window. Track evaluator questions and disposition.",
    checklist: [
      "Has submission receipt been confirmed?",
      "Are we tracking evaluation notice windows?",
      "Is a debrief plan prepared for win or loss?",
      "Are we monitoring GAO / COFC protest windows?",
    ],
  },
];

export const stageByKey = Object.fromEntries(
  pipelineStages.map((s) => [s.key, s]),
) as Record<PipelineStageKey, PipelineStage>;

export type Opportunity = {
  id: string;
  solicitationNumber: string;
  title: string;
  agency: string;
  naics: string;
  source: "Federal" | "State/Local" | "Commercial" | "DIBBS" | "SBIR/STTR";
  pipelineAdvisor: string;
  stage: PipelineStageKey;
  priority: "Low" | "Medium" | "High" | "Critical";
  status:
    | "Active"
    | "On Hold"
    | "Won't Respond"
    | "Submitted"
    | "Won"
    | "Lost"
    | "Cancelled";
  rfpRelease?: string;
  responseDue: string;
  estimatedValueLow: number;
  estimatedValueHigh: number;
  probability: number;
  pipelineValue: number;
  priorityNote?: string;
  checklistProgress: Record<string, boolean>;
  notes: { stage: PipelineStageKey; author: string; at: string; text: string }[];
};

export const opportunities: Opportunity[] = [
  {
    id: "OPP-2090195",
    solicitationNumber: "P-2090195",
    title: "IT Audit Services — Cybersecurity",
    agency: "Dept. of Treasury / OIG",
    naics: "541512",
    source: "Federal",
    pipelineAdvisor: "SYSUSA",
    stage: "S4_QUALIFICATION",
    priority: "High",
    status: "Won't Respond",
    rfpRelease: "2025-02-14",
    responseDue: "2025-03-21",
    estimatedValueLow: 1_200_000,
    estimatedValueHigh: 3_000_000,
    probability: 32,
    pipelineValue: 0,
    priorityNote:
      "Incumbent advantage is strong; pricing gap greater than 18%. Recommend no-bid.",
    checklistProgress: {
      "Is our Q&A complete?": true,
      "Are we set apart from our competitors?": false,
      "Is our tech/management approach appropriate?": true,
      "Is our pricing strategy appropriate?": false,
      "Is customer receptive to our approach?": false,
      "Have we determined an appropriate project manager?": true,
      "Where needed, do we have subcontractor agreements?": false,
      "Do we have a good past performance record?": true,
      "Have we conducted a Pursue/No Pursue Tollgate?": false,
    },
    notes: [
      {
        stage: "S4_QUALIFICATION",
        author: "J. Calder",
        at: "2 days ago",
        text: "Pricing gap vs. incumbent too wide. Advise no-bid unless teaming with 8(a).",
      },
    ],
  },
  {
    id: "OPP-25002",
    solicitationNumber: "P25002",
    title: "Managed Information Technology (IT) Services Provider",
    agency: "Dept. of Energy / NETL",
    naics: "541511",
    source: "Federal",
    pipelineAdvisor: "SYSUSA",
    stage: "S4_QUALIFICATION",
    priority: "Medium",
    status: "Active",
    rfpRelease: "2025-03-02",
    responseDue: "2025-04-28",
    estimatedValueLow: 7_000_000,
    estimatedValueHigh: 12_500_000,
    probability: 54,
    pipelineValue: 5_000_000,
    checklistProgress: {
      "Is our Q&A complete?": true,
      "Are we set apart from our competitors?": true,
      "Is our tech/management approach appropriate?": true,
      "Is our pricing strategy appropriate?": false,
      "Is customer receptive to our approach?": true,
      "Have we determined an appropriate project manager?": true,
      "Where needed, do we have subcontractor agreements?": false,
      "Do we have a good past performance record?": true,
      "Have we conducted a Pursue/No Pursue Tollgate?": false,
    },
    notes: [],
  },
  {
    id: "OPP-N00024-25-R-0094",
    solicitationNumber: "N00024-25-R-0094",
    title: "Shipboard AI-Enabled Decision Support Services",
    agency: "Dept. of Navy / NAVSEA",
    naics: "541512",
    source: "Federal",
    pipelineAdvisor: "J. Calder",
    stage: "S7_WRITING",
    priority: "Critical",
    status: "Active",
    rfpRelease: "2026-03-18",
    responseDue: "2026-04-29",
    estimatedValueLow: 48_000_000,
    estimatedValueHigh: 48_000_000,
    probability: 62,
    pipelineValue: 29_760_000,
    checklistProgress: {
      "Has Pink Team been completed and addressed?": true,
      "Is Red Team scheduled and staffed?": true,
      "Are all graphics and tables locked?": false,
      "Has the price volume been cross-checked?": false,
    },
    notes: [],
  },
  {
    id: "OPP-GSA-26-Q-7781",
    solicitationNumber: "GSA-26-Q-7781",
    title: "Agency-Wide Data Platform Modernization",
    agency: "GSA / FAS",
    naics: "541512",
    source: "Federal",
    pipelineAdvisor: "M. Reyes",
    stage: "S7_WRITING",
    priority: "High",
    status: "Active",
    rfpRelease: "2026-03-22",
    responseDue: "2026-04-19",
    estimatedValueLow: 18_000_000,
    estimatedValueHigh: 18_000_000,
    probability: 71,
    pipelineValue: 12_780_000,
    checklistProgress: {
      "Has Pink Team been completed and addressed?": true,
      "Is Red Team scheduled and staffed?": false,
      "Are all graphics and tables locked?": false,
      "Has the price volume been cross-checked?": true,
    },
    notes: [],
  },
  {
    id: "OPP-W56KGY-26-R-1178",
    solicitationNumber: "W56KGY-26-R-1178",
    title: "Battalion Mission Command Sustainment (BMCS)",
    agency: "US Army / PEO C3T",
    naics: "541330",
    source: "Federal",
    pipelineAdvisor: "P. Hollis",
    stage: "S3_POSITIONING",
    priority: "High",
    status: "Active",
    responseDue: "2026-05-14",
    estimatedValueLow: 112_000_000,
    estimatedValueHigh: 112_000_000,
    probability: 41,
    pipelineValue: 45_920_000,
    checklistProgress: {
      "Do we have an executive sponsor?": true,
      "Have we met with at least one decision-maker?": true,
      "Do we have a differentiated win theme draft?": false,
      "Have we identified key teaming partners?": true,
    },
    notes: [],
  },
  {
    id: "OPP-SSQ-26-I-2203",
    solicitationNumber: "SSQ-26-I-2203",
    title: "Sources Sought — Zero Trust Architecture Integration",
    agency: "Dept. of State / CIO",
    naics: "541519",
    source: "Federal",
    pipelineAdvisor: "L. Vasquez",
    stage: "S2_SOURCES_SOUGHT",
    priority: "Medium",
    status: "Active",
    responseDue: "2026-04-22",
    estimatedValueLow: 0,
    estimatedValueHigh: 0,
    probability: 28,
    pipelineValue: 0,
    checklistProgress: {
      "Have we drafted a capability statement?": true,
      "Have we attended the industry day?": false,
      "Have we requested a 1:1 with the buying office?": true,
      "Are we tracking amendments to the RFI?": true,
    },
    notes: [],
  },
  {
    id: "OPP-HHS-26-R-3456",
    solicitationNumber: "HHS-26-R-3456",
    title: "Public Health Analytics Platform (PHAP)",
    agency: "HHS / CDC",
    naics: "541511",
    source: "Federal",
    pipelineAdvisor: "T. Nakamura",
    stage: "S8_SUBMITTED",
    priority: "Medium",
    status: "Submitted",
    rfpRelease: "2026-02-27",
    responseDue: "2026-05-03",
    estimatedValueLow: 7_400_000,
    estimatedValueHigh: 7_400_000,
    probability: 12,
    pipelineValue: 888_000,
    checklistProgress: {
      "Has submission receipt been confirmed?": true,
      "Are we tracking evaluation notice windows?": true,
      "Is a debrief plan prepared for win or loss?": false,
      "Are we monitoring GAO / COFC protest windows?": false,
    },
    notes: [],
  },
];

export const opportunityById = Object.fromEntries(
  opportunities.map((o) => [o.id, o]),
) as Record<string, Opportunity>;

export type WinLossBucket = {
  key: "Won" | "Lost" | "Responded" | "Cancelled" | "No Bid";
  count: number;
  value: number;
};

export const historicalWinLoss: WinLossBucket[] = [
  { key: "Won", count: 8, value: 68_500_000 },
  { key: "Lost", count: 12, value: 112_300_000 },
  { key: "Responded", count: 5, value: 18_200_000 },
  { key: "No Bid", count: 21, value: 0 },
  { key: "Cancelled", count: 3, value: 0 },
];
