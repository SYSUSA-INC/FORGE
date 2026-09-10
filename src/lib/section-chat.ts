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

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalSections,
  proposals,
  sectionChatMessages,
  solicitations,
  users,
  type SectionChatRole,
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
  | { ok: true; system: string; messages: AIMessage[]; proposalId: string }
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
    proposalId: row.proposal.id,
  };
}

// ─────────────────────────────────────────────────────────────────────
// BL-FB-CHAT-PERSIST — persisted thread per section
// ─────────────────────────────────────────────────────────────────────

/** Most recent turns shown when a thread is reopened. */
export const CHAT_LOAD_LIMIT = 40;

export type SectionChatTurn = {
  id: string;
  role: SectionChatRole;
  content: string;
  createdAt: string;
  /** Display name of the user who wrote a user turn (or asked, for assistant turns). */
  authorName: string;
  /** True when the viewer wrote this turn. */
  isMine: boolean;
  stubbed: boolean;
};

/**
 * Confirm a section belongs to the org and return its proposal id.
 * Callers use this before mutating a thread so a foreign section id can
 * never be written to.
 */
export async function findSectionForOrg(input: {
  organizationId: string;
  sectionId: string;
}): Promise<{ proposalId: string } | null> {
  const [row] = await db
    .select({ proposalId: proposalSections.proposalId })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposalSections.id, input.sectionId),
        eq(proposals.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The last `limit` turns of a section's thread, oldest first, for display. */
export async function loadSectionChatHistory(input: {
  organizationId: string;
  sectionId: string;
  viewerUserId: string;
  limit?: number;
}): Promise<SectionChatTurn[]> {
  const rows = await db
    .select({
      id: sectionChatMessages.id,
      role: sectionChatMessages.role,
      content: sectionChatMessages.content,
      createdAt: sectionChatMessages.createdAt,
      userId: sectionChatMessages.userId,
      stubbed: sectionChatMessages.stubbed,
      authorName: users.name,
    })
    .from(sectionChatMessages)
    .leftJoin(users, eq(users.id, sectionChatMessages.userId))
    .where(
      and(
        eq(sectionChatMessages.organizationId, input.organizationId),
        eq(sectionChatMessages.sectionId, input.sectionId),
      ),
    )
    .orderBy(desc(sectionChatMessages.createdAt))
    .limit(input.limit ?? CHAT_LOAD_LIMIT);

  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    authorName: r.authorName ?? "",
    isMine: r.userId === input.viewerUserId,
    stubbed: r.stubbed,
  }));
}

/**
 * The last `turns` messages as model context, oldest first. The server
 * owns this so a client cannot feed the model a history it never had.
 */
export async function loadSectionChatModelHistory(input: {
  organizationId: string;
  sectionId: string;
  turns?: number;
}): Promise<ChatHistoryMessage[]> {
  const rows = await db
    .select({
      role: sectionChatMessages.role,
      content: sectionChatMessages.content,
    })
    .from(sectionChatMessages)
    .where(
      and(
        eq(sectionChatMessages.organizationId, input.organizationId),
        eq(sectionChatMessages.sectionId, input.sectionId),
      ),
    )
    .orderBy(desc(sectionChatMessages.createdAt))
    .limit(input.turns ?? CHAT_HISTORY_TURNS);

  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

/**
 * Persist one exchange. Two sequential inserts (Neon-pgbouncer rule, no
 * transaction); a failure between them leaves a lone user turn, which
 * the next reply simply follows.
 */
export async function appendSectionChatTurns(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  userId: string | null;
  userMessage: string;
  assistantReply: string;
  stubbed: boolean;
}): Promise<void> {
  await db.insert(sectionChatMessages).values({
    organizationId: input.organizationId,
    proposalId: input.proposalId,
    sectionId: input.sectionId,
    userId: input.userId,
    role: "user",
    content: input.userMessage,
  });
  await db.insert(sectionChatMessages).values({
    organizationId: input.organizationId,
    proposalId: input.proposalId,
    sectionId: input.sectionId,
    userId: input.userId,
    role: "assistant",
    content: input.assistantReply,
    stubbed: input.stubbed,
  });
}

/** Delete a section's thread; returns rows removed. */
export async function clearSectionChat(input: {
  organizationId: string;
  sectionId: string;
}): Promise<number> {
  const deleted = await db
    .delete(sectionChatMessages)
    .where(
      and(
        eq(sectionChatMessages.organizationId, input.organizationId),
        eq(sectionChatMessages.sectionId, input.sectionId),
      ),
    )
    .returning({ id: sectionChatMessages.id });
  return deleted.length;
}
