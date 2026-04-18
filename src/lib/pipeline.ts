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

// Stage definitions are retained so the UI can render the full 8-stage
// funnel / checklist template even when no opportunities are in the pipeline.
export const pipelineStages: PipelineStage[] = [
  {
    key: "S1_IDENTIFIED",
    label: "Identified Opportunity",
    count: 0,
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
    count: 0,
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
    count: 0,
    valueLow: 0,
    valueHigh: 0,
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
    count: 0,
    valueLow: 0,
    valueHigh: 0,
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
    count: 0,
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
    count: 0,
    valueLow: 0,
    valueHigh: 0,
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
    count: 0,
    valueLow: 0,
    valueHigh: 0,
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
    count: 0,
    valueLow: 0,
    valueHigh: 0,
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

export const opportunities: Opportunity[] = [];

export const opportunityById = Object.fromEntries(
  opportunities.map((o) => [o.id, o]),
) as Record<string, Opportunity>;

export type WinLossBucket = {
  key: "Won" | "Lost" | "Responded" | "Cancelled" | "No Bid";
  count: number;
  value: number;
};

export const historicalWinLoss: WinLossBucket[] = [];
