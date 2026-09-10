/**
 * BL-AI-STREAMING — shared section-chat preparation.
 *
 * Builds the system prompt (persona + proposal / section / solicitation
 * context) and the message list for a chat turn. Used by the
 * `chatWithSectionAction` server action and the `/api/ai/chat` streaming
 * route so both produce identical prompts. Every query is scoped by the
 * caller-supplied organizationId; callers own auth, gates and the call.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalSections,
  proposals,
  solicitations,
} from "@/db/schema";
import type { AIMessage } from "@/lib/ai";
import type { ChatHistoryMessage } from "@/lib/ai-stream-types";

export const CHAT_SYSTEM = `You are an expert federal proposal writer embedded inside FORGE. You are helping the proposal author work on a specific section of their in-progress government proposal. You have context about the opportunity, the organization, and the solicitation requirements.

Your role:
- Answer questions about how to approach, strengthen, or structure the section.
- Suggest specific language or paragraphs on request.
- Flag compliance issues or missing elements.
- Be direct and specific — cite section references (e.g. [L.5.2.1]) when relevant.
- Keep responses concise but actionable. No generic advice.
- If you suggest replacement text, make it immediately usable.

You are NOT a general assistant. Stay focused on improving this proposal section.`;

/** Per-section chat rate limit, shared by the action and the route. */
export const CHAT_RATE_LIMIT = { limit: 30, windowSeconds: 3600 } as const;
export const CHAT_MAX_TOKENS = 1200;
export const CHAT_TEMPERATURE = 0.4;
/** Only the most recent turns go to the model, to stay within budget. */
export const CHAT_HISTORY_TURNS = 6;

export type PreparedSectionChat =
  | { ok: true; system: string; messages: AIMessage[] }
  | { ok: false; error: string };

export async function prepareSectionChat(input: {
  organizationId: string;
  sectionId: string;
  history: ChatHistoryMessage[];
  message: string;
}): Promise<PreparedSectionChat> {
  const { organizationId } = input;

  const [row] = await db
    .select({
      section: proposalSections,
      proposal: proposals,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      incumbent: opportunities.incumbent,
      opportunityDescription: opportunities.description,
      opportunityId: proposals.opportunityId,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposalSections.id, input.sectionId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Section not found." };

  const [orgRow] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  // Load solicitation context (best-effort).
  let solBlock = "";
  try {
    const [sol] = await db
      .select({
        sectionLSummary: solicitations.sectionLSummary,
        sectionMSummary: solicitations.sectionMSummary,
        extractedRequirements: solicitations.extractedRequirements,
      })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.opportunityId, row.opportunityId),
          eq(solicitations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (sol) {
      const reqs = (sol.extractedRequirements ?? [])
        .slice(0, 15)
        .map((r, i) => `${i + 1}. [${r.ref || "?"}] ${r.kind}: ${r.text.slice(0, 200)}`)
        .join("\n");
      solBlock = [
        sol.sectionLSummary && `Section L: ${sol.sectionLSummary.slice(0, 500)}`,
        sol.sectionMSummary && `Section M: ${sol.sectionMSummary.slice(0, 500)}`,
        reqs && `Requirements:\n${reqs}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  } catch {
    // best effort
  }

  // BL-FB-GEN-THEMES — surface the proposal's win themes so the chat
  // assistant can reinforce them when suggesting language.
  const winThemes = (row.proposal.winThemes ?? []).slice(0, 3);
  const themesBlock =
    winThemes.length > 0
      ? `\nWin themes (weave these into every suggestion):\n${winThemes
          .map((t, i) => `  ${i + 1}. ${t.title}: ${t.statement}`)
          .join("\n")}`
      : "";

  const contextBlock = [
    `Organization: ${orgRow?.name ?? "unknown"}`,
    `Proposal: ${row.proposal.title}`,
    `Agency: ${row.agency || "(unknown)"}`,
    `Solicitation: ${row.solicitationNumber || "(none)"}`,
    `NAICS: ${row.naicsCode || "(unknown)"}`,
    `Set-aside: ${row.setAside || "(unrestricted)"}`,
    row.incumbent && `Incumbent: ${row.incumbent}`,
    row.opportunityDescription &&
      `Opportunity description: ${row.opportunityDescription.slice(0, 800)}`,
    themesBlock,
    solBlock && `\nSolicitation context:\n${solBlock}`,
    `\nSection being worked: "${row.section.title}" (kind: ${row.section.kind}${row.section.pageLimit ? `, page cap: ${row.section.pageLimit}` : ""})`,
    row.section.content?.trim() &&
      `\nCurrent draft (${row.section.wordCount} words):\n${row.section.content.slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: AIMessage[] = [
    ...input.history.slice(-CHAT_HISTORY_TURNS).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: input.message },
  ];

  return {
    ok: true,
    system: `${CHAT_SYSTEM}\n\n--- CONTEXT ---\n${contextBlock}`,
    messages,
  };
}
