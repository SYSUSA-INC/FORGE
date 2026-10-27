import { LESSON_LIMITS, SECTION_KINDS } from "@/lib/lessons";

/**
 * BL-LESSONS-LOOP — the prompt that drafts lessons from a decided bid's
 * outcome, debrief, winner analysis, open review comments and the loss
 * patterns that match. Pure: strings only. Every evidence id the model
 * may cite is given here, and the acceptance pass drops any it invents.
 */
const TEXT_MAX = 700;

export type LessonsExtractInput = {
  proposal: { title: string; agency: string; naicsCode: string; outcome: string; reasons: string[]; summary: string; lessonsLearned: string; awardedTo: string };
  outcomeId: string;
  debrief: { id: string; status: string; strengths: string; weaknesses: string; improvements: string; notes: string } | null;
  winnerGaps: { id: string; text: string }[];
  reviewComments: { id: string; section: string; text: string }[];
  lossPatterns: { id: string; title: string; detail: string }[];
  sectionKinds: string[];
  /** Lessons already on this opportunity, so the model adds rather than repeats. */
  existing: string[];
};

export function buildLessonsExtractPrompt(input: LessonsExtractInput): { system: string; messages: { role: "user"; content: string }[] } {
  const system = `You are a capture lead writing down what a bid taught the company, for the people who will confirm each lesson and for the tools that draft and judge the next bid.

Rules:
- Write at most ${LESSON_LIMITS.perDraft} lessons, each one sentence in the imperative, specific enough to act on and tied to a fact from the material ("Price the transition at cost: lost VA ITSM on price by 8%"). Fewer, grounded lessons beat a full list.
- "kind": do (repeat it), avoid (never again), watch (a risk to check early).
- "source": the material the lesson rests on most: outcome, debrief, winner_analysis or review.
- "appliesTo": where the lesson bears. Name the agency or NAICS code when it is specific to them; name section kinds from this list when it is about writing: ${SECTION_KINDS.join(", ")}; name a capability when it is about one. Leave a list empty rather than guess.
- "evidence": the ids of the material each lesson rests on, exactly as given.
- Use only the material. Never invent a reason, a competitor, a number or a requirement. Do not repeat a lesson already listed.`;

  const p = input.proposal;
  const q = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
  const user = `Bid: ${p.title}
Agency: ${p.agency || "unknown"} · NAICS: ${p.naicsCode || "unknown"} · Outcome: ${p.outcome.toUpperCase()}${p.awardedTo ? ` · awarded to ${p.awardedTo}` : ""}
Outcome record (id=outcome:${input.outcomeId}):
- reasons: ${p.reasons.join(", ") || "(none recorded)"}
- summary: ${q(p.summary) || "(none)"}
- lessons the team wrote: ${q(p.lessonsLearned) || "(none)"}

Debrief${input.debrief ? ` (id=debrief:${input.debrief.id}, ${input.debrief.status})` : ""}:
${input.debrief ? `- strengths: ${q(input.debrief.strengths) || "(none)"}\n- weaknesses: ${q(input.debrief.weaknesses) || "(none)"}\n- improvements: ${q(input.debrief.improvements) || "(none)"}\n- notes: ${q(input.debrief.notes) || "(none)"}` : "(none)"}

Gaps found against winners (${input.winnerGaps.length}):
${input.winnerGaps.map((g) => `- id=winner:${g.id} | ${q(g.text)}`).join("\n") || "(none)"}

Open reviewer comments (${input.reviewComments.length}):
${input.reviewComments.map((c) => `- id=comment:${c.id} | ${c.section} | ${q(c.text)}`).join("\n") || "(none)"}

Loss patterns across this company's decided bids (${input.lossPatterns.length}):
${input.lossPatterns.map((l) => `- id=pattern:${l.id} | ${l.title}: ${q(l.detail)}`).join("\n") || "(none)"}

Section kinds in this proposal: ${input.sectionKinds.join(", ") || "(none)"}
Lessons already recorded on this opportunity (${input.existing.length}):
${input.existing.map((t) => `- ${t}`).join("\n") || "(none)"}

Write the lessons with the tool.`;

  return { system, messages: [{ role: "user", content: user }] };
}
