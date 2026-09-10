/**
 * BL-FB-WIN-CROSS-LOSS — AI narrative over detected loss patterns.
 *
 * The patterns are computed deterministically (loss-patterns.ts). The
 * model's job is to explain them to a capture lead and turn them into
 * next actions, citing pattern ids so every sentence traces back to
 * data. It is told not to introduce patterns of its own.
 */
import { z } from "zod";
import type { AIMessage } from "@/lib/ai";
import type { LossIntelligence } from "@/lib/loss-patterns";

export const lossNarrativeSchema = z.object({
  headline: z.string(),
  insights: z
    .array(
      z.object({
        title: z.string(),
        explanation: z.string(),
        action: z.string(),
        patternIds: z.array(z.string()),
      }),
    )
    .max(5),
  caveats: z.array(z.string()).max(4),
});

export type LossNarrative = z.infer<typeof lossNarrativeSchema>;

const LOSS_NARRATIVE_SYSTEM = `You are a capture-strategy analyst inside FORGE, a federal proposal platform. You are handed cross-pursuit loss patterns that were detected deterministically from an organization's recorded outcomes, debriefs and competitor data.

Output ONLY a single JSON object:
{
  "headline": "<one sentence: the single most important thing this org should change>",
  "insights": [
    {
      "title": "<short>",
      "explanation": "<2-3 sentences grounded in the cited patterns>",
      "action": "<one concrete action for the next one or two pursuits>",
      "patternIds": ["<id of every pattern this insight draws on>"]
    }
  ],
  "caveats": ["<sample-size or data-quality warnings the reader must hold in mind>"]
}

Rules:
- Use ONLY the patterns and figures provided. Do not introduce competitors, agencies, reasons or numbers that are not in the input.
- Every insight must cite at least one patternId from the input.
- Prefer fewer, sharper insights (2-4). Merge patterns that point at the same root cause.
- Actions are specific: who does what before which pursuit. No generic advice.
- Small samples are real risks: say so in caveats when a pattern rests on 2-3 pursuits.
- Be direct. No flattery, no filler.`;

export function buildLossNarrativePrompt(input: {
  organizationName: string;
  intel: LossIntelligence;
}): { system: string; messages: AIMessage[] } {
  const { intel } = input;
  const patternLines = intel.patterns.map(
    (p) =>
      `- id=${p.id} | ${p.severity.toUpperCase()} | ${p.title}\n    ${p.detail}\n    evidence: ${p.evidence
        .slice(0, 6)
        .map((e) => `"${e.title}"${e.decidedAt ? ` (${e.decidedAt.slice(0, 10)})` : ""}`)
        .join("; ")}${p.evidence.length > 6 ? ` … +${p.evidence.length - 6} more` : ""}`,
  );
  const competitorLines = intel.competitors
    .filter((c) => c.lostTo > 0 || c.faced >= 2)
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.name}: faced ${c.faced}, lost to ${c.lostTo}, won against ${c.wonAgainst}${c.leadingReason ? `, leading reason ${c.leadingReason}` : ""}`,
    );
  const reasonLines = intel.reasonTotals.slice(0, 8).map((r) => `- ${r.label}: ${r.count}`);

  const user = [
    `Organization: ${input.organizationName}`,
    `Decided pursuits: ${intel.decided} (${intel.won} won / ${intel.lost} lost)${intel.winRate !== null ? ` · win rate ${Math.round(intel.winRate * 100)}%` : ""}`,
    `Losses with debrief notes: ${intel.lossesWithDebrief} of ${intel.lost}`,
    ``,
    `Loss reasons (count of losses citing each):`,
    ...(reasonLines.length ? reasonLines : ["- (none recorded)"]),
    ``,
    `Detected patterns (${intel.patterns.length}):`,
    ...(patternLines.length ? patternLines : ["- (none met the thresholds)"]),
    ``,
    `Competitor record:`,
    ...(competitorLines.length ? competitorLines : ["- (no competitors recorded)"]),
    ``,
    `Return strict JSON per the schema in the system prompt.`,
  ].join("\n");

  return {
    system: LOSS_NARRATIVE_SYSTEM,
    messages: [{ role: "user", content: user }],
  };
}
