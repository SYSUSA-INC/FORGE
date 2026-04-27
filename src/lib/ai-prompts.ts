import type { AIMessage } from "@/lib/ai";

export type PipelineSnapshot = {
  organizationName: string;
  asOf: string;
  opportunities: {
    total: number;
    byStage: Record<string, number>;
    topByPwin: {
      title: string;
      agency: string;
      stage: string;
      pwin: number | null;
      dueDate: string | null;
    }[];
    upcomingDueWithin14Days: {
      title: string;
      agency: string;
      dueDate: string;
    }[];
  };
  proposals: {
    total: number;
    byStage: Record<string, number>;
    inActiveReview: number;
  };
};

const PIPELINE_BRIEF_SYSTEM = `You are an analyst inside FORGE — a federal proposal operations platform. You write concise, candid daily briefs for capture and proposal leaders.

Style rules:
- 4–7 sentences max. Plain prose. No markdown headings, no bullet points.
- Lead with the most important thing the leader needs to act on this week.
- Cite specific pursuits by title when calling them out.
- Note risks frankly: late-stage opportunities with no proposal, proposals stuck in a single stage, missing PWin.
- Do NOT invent numbers. Only use figures present in the snapshot.
- Do NOT use governance/risk/compliance jargon. Speak in capture language: pursuit, capture, color team, Section M, gate.
- If the snapshot is empty (no opportunities), explain there's nothing to brief on yet and suggest seeding pursuits via /opportunities/import.`;

export type OpportunitySnapshot = {
  organizationName: string;
  asOf: string;
  opportunity: {
    title: string;
    agency: string;
    office: string;
    stage: string;
    solicitationNumber: string;
    naicsCode: string;
    pscCode: string;
    setAside: string;
    contractType: string;
    placeOfPerformance: string;
    incumbent: string;
    valueLow: string;
    valueHigh: string;
    pwin: number;
    daysToDue: number | null;
    description: string;
  };
  evaluation: {
    rollupScore: number | null;
    strategicFit: number | null;
    customerRelationship: number | null;
    competitivePosture: number | null;
    resourceAvailability: number | null;
    financialAttractiveness: number | null;
    rationale: string;
  } | null;
  competitors: {
    name: string;
    isIncumbent: boolean;
    strengths: string;
    weaknesses: string;
    notes: string;
  }[];
  recentActivity: {
    kind: string;
    title: string;
    body: string;
    daysAgo: number;
  }[];
};

const OPPORTUNITY_BRIEF_SYSTEM = `You are an analyst inside FORGE — a federal proposal operations platform. You write concise, candid pursuit briefs for capture and proposal leaders thinking about a single opportunity.

Style rules:
- 5–8 sentences max. Plain prose. No markdown headings, no bullets.
- Lead with one of three takes: "strong pursue", "watch", or "consider no-bid", and tie it to one or two specific signals from the snapshot.
- Reference concrete numbers (PWin, evaluation dimension scores, days-to-due, value range) when they're present and meaningful.
- Call out incumbents and named competitors by name when present.
- Note the most recent activity if it's within 7 days; mention if the deal has been quiet for >14 days.
- Do NOT invent numbers, dates, or competitor names that aren't in the snapshot.
- Do NOT use governance/risk/compliance jargon. Speak in capture language: pursuit, capture, gate, Section M, set-aside, NAICS.
- If the snapshot is sparse (no evaluation, no competitors, no activity), say so honestly and suggest the next concrete step (e.g., "run a qualification scorecard", "log a call with the customer", "identify the incumbent").`;

export function buildOpportunityBriefPrompt(
  snapshot: OpportunitySnapshot,
): { system: string; messages: AIMessage[] } {
  const userPrompt = [
    `Write a pursuit brief for ${snapshot.organizationName} as of ${snapshot.asOf}.`,
    ``,
    `Opportunity snapshot (JSON):`,
    "```json",
    JSON.stringify(snapshot, null, 2),
    "```",
    ``,
    `Brief should help the leader decide whether to keep pushing on this pursuit, change the approach, or walk.`,
  ].join("\n");

  return {
    system: OPPORTUNITY_BRIEF_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export function buildPipelineBriefPrompt(
  snapshot: PipelineSnapshot,
): { system: string; messages: AIMessage[] } {
  const userPrompt = [
    `Write a pipeline brief for ${snapshot.organizationName} as of ${snapshot.asOf}.`,
    ``,
    `Snapshot (JSON):`,
    "```json",
    JSON.stringify(snapshot, null, 2),
    "```",
    ``,
    `Brief should help the reader decide what to chase, what to abandon, and what's at risk this week.`,
  ].join("\n");

  return {
    system: PIPELINE_BRIEF_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}
