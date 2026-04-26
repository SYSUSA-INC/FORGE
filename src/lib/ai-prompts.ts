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
