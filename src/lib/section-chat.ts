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

import { and, asc, count, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  memberships,
  opportunities,
  organizations,
  proposalSections,
  proposals,
  sectionChatMessages,
  sectionChatReads,
  users,
  type SectionChatRole,
} from "@/db/schema";
import type { AIMessage } from "@/lib/ai";
import type { ChatHistoryMessage } from "@/lib/ai-stream-types";
import { recordAudit } from "@/lib/audit-log";
import { CHAT_NOTE_MAX_CHARS, CHAT_NOTES_TO_MODEL_MAX, memberLabel, mentionSubject, notesForModel, sectionChatLink } from "@/lib/chat-mentions";
import { extractMentionUserIds, renderMentionsToPlain } from "@/lib/mentions";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { voiceGuidance } from "@/lib/customer-voice";
import { getCustomerVoice } from "@/lib/customer-voice-signals";
import { renderAttachmentsBlock } from "@/lib/chat-attachments-logic";
import { messageForModel } from "@/lib/chat-commands";
import { deleteChatAttachmentsForSection, loadChatAttachmentTexts } from "@/lib/section-chat-attachments";
import { voiceGuidanceForSection } from "@/lib/voice";
import { gatherWritingSignals, renderWritingSignals } from "@/lib/writing-signals";

/** BL-AIP-5 — how many general requirements the chat sees (mapped rows always go in full). */
const CHAT_GENERAL_REQUIREMENTS = 40;

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
  /**
   * BL-AIP-2 — the section as it stands in the editor; replaces the saved
   * body in the context so "make this paragraph tighter" refers to what
   * the writer is looking at.
   */
  currentBodyPlain?: string;
}): Promise<PreparedSectionChat> {
  const { organizationId } = input;
  const liveBody =
    typeof input.currentBodyPlain === "string" ? input.currentBodyPlain.trim() : "";

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

  // BL-AIP-5 — solicitation context (best-effort): the matrix rows mapped
  // to this section verbatim, then the merged requirement list across
  // every solicitation on the opportunity (it used to be 15 clauses at
  // 200 characters from whichever row came back first).
  let solBlock = "";
  try {
    const [loaded, mapped] = await Promise.all([
      loadOpportunityRequirements({ organizationId, opportunityId: row.opportunityId }),
      db
        .select({
          number: complianceItems.number,
          requirementText: complianceItems.requirementText,
        })
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.proposalSectionId, input.sectionId),
            eq(complianceItems.proposalId, row.proposal.id),
            ne(complianceItems.status, "not_applicable"),
          ),
        )
        .orderBy(asc(complianceItems.ordering))
        .limit(CHAT_GENERAL_REQUIREMENTS),
    ]);
    const mappedBlock = mapped
      .map((m, i) => `${i + 1}. [${m.number || "?"}] ${m.requirementText}`)
      .join("\n");
    const shown = loaded.requirements.slice(0, CHAT_GENERAL_REQUIREMENTS);
    const reqs = shown
      .map((r, i) => `${i + 1}. [${r.ref || "?"}] ${r.kind}: ${r.text.slice(0, 400)}`)
      .join("\n");
    solBlock = [
      mappedBlock && `Requirements mapped to this section (address every one):\n${mappedBlock}`,
      loaded.sectionLSummary && `Section L: ${loaded.sectionLSummary.slice(0, 500)}`,
      loaded.sectionMSummary && `Section M: ${loaded.sectionMSummary.slice(0, 500)}`,
      reqs &&
        `All extracted requirements (${shown.length}${loaded.requirements.length > shown.length ? ` of ${loaded.requirements.length}` : ""}):\n${reqs}`,
    ]
      .filter(Boolean)
      .join("\n\n");
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

  // BL-AIP-6 — what the team has learned: reviewer comments on this
  // section, debrief weaknesses, winner gaps, AI-draft acceptance.
  let signalsBlock = "";
  try {
    const signals = await gatherWritingSignals({
      organizationId,
      proposalId: row.proposal.id,
      sectionId: input.sectionId,
      sectionKind: row.section.kind,
      agency: row.agency ?? "",
    });
    signalsBlock = renderWritingSignals(signals);
  } catch {
    // best effort
  }

  // BL-FB-GEN-VOC — the customer's own words, when this section echoes them.
  let voiceBlock = "";
  if (row.section.echoCustomerVoice) {
    try {
      const voice = await getCustomerVoice({ organizationId, proposalId: row.proposal.id });
      if (voice && voice.phrases.length > 0) {
        voiceBlock = `\nThe customer's own words${voice.agency ? ` (${voice.agency})` : ""} — where a suggestion is about the same thing, say it in these words or a close paraphrase; never force them in elsewhere, never say you are mirroring the solicitation:\n${voiceGuidance(voice.phrases, 12)
          .map((p) => `  - "${p.phrase}" (${p.source})`)
          .join("\n")}`;
      }
    } catch {
      // best effort
    }
  }

  // BL-FB-GEN-VOICE — the team's house style and the section author's own
  // voice, when they have an enabled profile (Slice 2: house style applies
  // with or without an author).
  let authorVoiceBlock = "";
  try {
    const voice = await voiceGuidanceForSection({ organizationId, sectionId: input.sectionId });
    if (voice) authorVoiceBlock = `\n${voice.guidance}`;
  } catch {
    // best effort
  }

  // BL-FB-CHAT-UPLOAD — documents the author attached to this conversation.
  let attachmentsBlock = "";
  try {
    attachmentsBlock = renderAttachmentsBlock(
      await loadChatAttachmentTexts({ organizationId, sectionId: input.sectionId }),
    );
  } catch {
    // best effort
  }

  // BL-FB-CHAT-MULTI Slice 2 — the team's notes, when this section opts
  // in: context about what the team decided, never instructions.
  let notesBlock = "";
  if (row.section.chatNotesToModel) {
    try {
      const notes = await db
        .select({ content: sectionChatMessages.content, name: users.name, email: users.email })
        .from(sectionChatMessages)
        .leftJoin(users, eq(users.id, sectionChatMessages.userId))
        .where(and(eq(sectionChatMessages.organizationId, organizationId), eq(sectionChatMessages.sectionId, input.sectionId), eq(sectionChatMessages.role, "note")))
        .orderBy(desc(sectionChatMessages.createdAt))
        .limit(CHAT_NOTES_TO_MODEL_MAX);
      const noteNames = notes.some((n) => n.content.includes("@[")) ? await memberNames(organizationId) : new Map<string, string>();
      notesBlock = notesForModel(
        notes.reverse().map((n) => ({
          author: n.name?.trim() || n.email?.split("@")[0] || "A teammate",
          content: renderMentionsToPlain(n.content, (id) => noteNames.get(id) ?? null),
        })),
      );
    } catch {
      // best effort
    }
  }

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
    voiceBlock,
    authorVoiceBlock,
    solBlock && `\nSolicitation context:\n${solBlock}`,
    attachmentsBlock && `\n${attachmentsBlock}`,
    notesBlock && `\n${notesBlock}`,
    signalsBlock && `\nWhat the team has learned (resolve reviewer comments in the text; answer past weaknesses with evidence; never cite them):\n${signalsBlock}`,
    `\nSection being worked: "${row.section.title}" (kind: ${row.section.kind}${row.section.pageLimit ? `, page cap: ${row.section.pageLimit}` : ""})`,
    (liveBody || row.section.content?.trim()) &&
      `\nCurrent draft (${
        liveBody
          ? liveBody.split(/\s+/g).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
          : row.section.wordCount
      } words):\n${(liveBody || row.section.content || "").slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  // BL-FB-CHAT-SLASH — the thread stores what the author typed
  // ("/shrink-by 30%"); the model reads the command's expansion, for the
  // new turn and for earlier command turns in the history alike.
  // BL-FB-CHAT-MULTI — and it reads "@Name", never the stored "@[id]".
  const recent = input.history.slice(-CHAT_HISTORY_TURNS);
  const names = [...recent.map((m) => m.content), input.message].some((c) => c.includes("@[")) ? await memberNames(organizationId) : new Map<string, string>();
  const forModel = (text: string) => renderMentionsToPlain(messageForModel(text), (id) => names.get(id) ?? null);
  const messages: AIMessage[] = [
    ...recent.map((m) => ({
      role: m.role,
      content: m.role === "user" ? forModel(m.content) : m.content,
    })),
    { role: "user" as const, content: forModel(input.message) },
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

export type SectionChatReplyTarget = { id: string; role: SectionChatRole; authorName: string; content: string };

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
  /** BL-FB-CHAT-MULTI Slice 2 — the message this one answers, when it is a reply. */
  replyToMessageId: string | null;
  replyTo: SectionChatReplyTarget | null;
};

/** The parents of the replies in a thread, by id, scoped to the section. */
async function loadReplyTargets(organizationId: string, sectionId: string, ids: readonly string[]): Promise<Map<string, SectionChatReplyTarget>> {
  const wanted = Array.from(new Set(ids));
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: sectionChatMessages.id, role: sectionChatMessages.role, content: sectionChatMessages.content, name: users.name, email: users.email })
    .from(sectionChatMessages)
    .leftJoin(users, eq(users.id, sectionChatMessages.userId))
    .where(and(eq(sectionChatMessages.organizationId, organizationId), eq(sectionChatMessages.sectionId, sectionId), inArray(sectionChatMessages.id, wanted)));
  return new Map(rows.map((r) => [r.id, { id: r.id, role: r.role, authorName: r.role === "assistant" ? "AI" : r.name?.trim() || r.email?.split("@")[0] || "", content: r.content }] as const));
}

/** A reply target is honoured only when it is a message of the same section in the same tenant. */
async function replyTargetInThread(organizationId: string, sectionId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [p] = await db
    .select({ id: sectionChatMessages.id })
    .from(sectionChatMessages)
    .where(and(eq(sectionChatMessages.id, id), eq(sectionChatMessages.organizationId, organizationId), eq(sectionChatMessages.sectionId, sectionId)))
    .limit(1);
  return p?.id ?? null;
}

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
      replyToMessageId: sectionChatMessages.replyToMessageId,
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
  const targets = await loadReplyTargets(
    input.organizationId,
    input.sectionId,
    rows.map((r) => r.replyToMessageId).filter((id): id is string => !!id),
  );

  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    authorName: r.authorName ?? "",
    isMine: r.userId === input.viewerUserId,
    stubbed: r.stubbed,
    replyToMessageId: r.replyToMessageId,
    replyTo: r.replyToMessageId ? (targets.get(r.replyToMessageId) ?? null) : null,
  }));
}

export type SectionChatThread = { messages: SectionChatTurn[]; lastReadAt: string | null; notesToModel: boolean };

/**
 * BL-FB-CHAT-MULTI Slice 2 — the thread for display plus what the viewer
 * needs to read it: when they last looked (for the "new since you
 * looked" line) and whether the model reads the team's notes here. Null
 * when the section is not this organization's.
 */
export async function loadSectionChatThread(input: {
  organizationId: string;
  sectionId: string;
  viewerUserId: string;
  limit?: number;
}): Promise<SectionChatThread | null> {
  const { organizationId } = input;
  const [section] = await db
    .select({ chatNotesToModel: proposalSections.chatNotesToModel })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!section) return null;
  const [read] = await db
    .select({ lastReadAt: sectionChatReads.lastReadAt })
    .from(sectionChatReads)
    .where(and(eq(sectionChatReads.organizationId, organizationId), eq(sectionChatReads.sectionId, input.sectionId), eq(sectionChatReads.userId, input.viewerUserId)))
    .limit(1);
  const messages = await loadSectionChatHistory(input);
  return { messages, lastReadAt: read?.lastReadAt.toISOString() ?? null, notesToModel: section.chatNotesToModel };
}

/** BL-FB-CHAT-MULTI Slice 2 — the viewer has looked at this thread now; one row per (section, user). */
export async function markSectionChatRead(input: {
  organizationId: string;
  sectionId: string;
  userId: string;
  now?: Date;
}): Promise<{ ok: true; lastReadAt: string } | { ok: false; error: string }> {
  const { organizationId } = input;
  const owned = await findSectionForOrg({ organizationId, sectionId: input.sectionId });
  if (!owned) return { ok: false, error: "Section not found." };
  const now = input.now ?? new Date();
  await db
    .insert(sectionChatReads)
    .values({ organizationId, sectionId: input.sectionId, userId: input.userId, lastReadAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [sectionChatReads.sectionId, sectionChatReads.userId], set: { lastReadAt: now, updatedAt: now } });
  return { ok: true, lastReadAt: now.toISOString() };
}

/**
 * BL-FB-CHAT-MULTI Slice 2 — per section of a proposal, how many
 * messages by someone else landed since the viewer last looked (all of
 * them when they never have). The AI's replies to the viewer's own
 * questions carry the viewer's id and are never new to them.
 */
export async function unreadChatCounts(input: {
  organizationId: string;
  proposalId: string;
  viewerUserId: string;
}): Promise<Record<string, number>> {
  const { organizationId } = input;
  const rows = await db
    .select({ sectionId: sectionChatMessages.sectionId, n: count() })
    .from(sectionChatMessages)
    .leftJoin(
      sectionChatReads,
      and(
        eq(sectionChatReads.sectionId, sectionChatMessages.sectionId),
        eq(sectionChatReads.userId, input.viewerUserId),
        eq(sectionChatReads.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(sectionChatMessages.organizationId, organizationId),
        eq(sectionChatMessages.proposalId, input.proposalId),
        or(isNull(sectionChatMessages.userId), ne(sectionChatMessages.userId, input.viewerUserId)),
        or(isNull(sectionChatReads.lastReadAt), gt(sectionChatMessages.createdAt, sectionChatReads.lastReadAt)),
      ),
    )
    .groupBy(sectionChatMessages.sectionId);
  return Object.fromEntries(rows.map((r) => [r.sectionId, Number(r.n)] as const));
}

/** BL-FB-CHAT-MULTI Slice 2 — whether the chat model reads this section's team notes; audited. */
export async function setSectionChatNotesToModel(input: {
  organizationId: string;
  sectionId: string;
  enabled: boolean;
  actor: { userId: string | null; email?: string | null };
}): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  const { organizationId } = input;
  const owned = await findSectionForOrg({ organizationId, sectionId: input.sectionId });
  if (!owned) return { ok: false, error: "Section not found." };
  await db
    .update(proposalSections)
    .set({ chatNotesToModel: input.enabled, updatedAt: new Date() })
    .where(eq(proposalSections.id, input.sectionId));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "section_chat.notes_to_model",
    resourceType: "proposal_section",
    resourceId: input.sectionId,
    metadata: { proposalId: owned.proposalId, enabled: input.enabled },
  });
  return { ok: true, enabled: input.enabled };
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
        // BL-FB-CHAT-MULTI — team notes are for people; the model sees the exchange only.
        inArray(sectionChatMessages.role, ["user", "assistant"]),
      ),
    )
    .orderBy(desc(sectionChatMessages.createdAt))
    .limit(input.turns ?? CHAT_HISTORY_TURNS);

  return rows.reverse().map((r) => ({ role: r.role as ChatHistoryMessage["role"], content: r.content }));
}

/**
 * Persist one exchange. Two sequential inserts (Neon-pgbouncer rule, no
 * transaction); a failure between them leaves a lone user turn, which
 * the next reply simply follows. Returns the ids so mentions in the user
 * turn can be notified.
 */
export async function appendSectionChatTurns(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  userId: string | null;
  userMessage: string;
  assistantReply: string;
  stubbed: boolean;
  /** BL-FB-CHAT-MULTI Slice 2 — the message the question answers; ignored unless it is in this thread. */
  replyToMessageId?: string | null;
}): Promise<{ userMessageId: string; assistantMessageId: string }> {
  const replyToMessageId = await replyTargetInThread(input.organizationId, input.sectionId, input.replyToMessageId);
  const [u] = await db
    .insert(sectionChatMessages)
    .values({
      organizationId: input.organizationId,
      proposalId: input.proposalId,
      sectionId: input.sectionId,
      userId: input.userId,
      role: "user",
      content: input.userMessage,
      replyToMessageId,
    })
    .returning({ id: sectionChatMessages.id });
  const [a] = await db
    .insert(sectionChatMessages)
    .values({
      organizationId: input.organizationId,
      proposalId: input.proposalId,
      sectionId: input.sectionId,
      userId: input.userId,
      role: "assistant",
      content: input.assistantReply,
      stubbed: input.stubbed,
    })
    .returning({ id: sectionChatMessages.id });
  return { userMessageId: u?.id ?? "", assistantMessageId: a?.id ?? "" };
}

/** Active members' display names, for resolving `@[id]` tokens. */
async function memberNames(organizationId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")));
  return new Map(rows.map((r) => [r.id, memberLabel(r)] as const));
}

export type NoteResult = { ok: true; message: SectionChatTurn; proposalId: string } | { ok: false; error: string };

/**
 * BL-FB-CHAT-MULTI — a teammate's note on the section's thread: no
 * model call, visible to everyone on the proposal, audited. The caller
 * notifies the people it @mentions.
 */
export async function appendSectionChatNote(input: {
  organizationId: string;
  sectionId: string;
  userId: string;
  content: string;
  /** BL-FB-CHAT-MULTI Slice 2 — the message the note answers; ignored unless it is in this thread. */
  replyToMessageId?: string | null;
  actor: { userId: string | null; email?: string | null };
}): Promise<NoteResult> {
  const { organizationId } = input;
  const content = input.content.trim().slice(0, CHAT_NOTE_MAX_CHARS);
  if (!content) return { ok: false, error: "Write something first." };
  const owned = await findSectionForOrg({ organizationId, sectionId: input.sectionId });
  if (!owned) return { ok: false, error: "Section not found." };
  const replyToMessageId = await replyTargetInThread(organizationId, input.sectionId, input.replyToMessageId);
  const [row] = await db
    .insert(sectionChatMessages)
    .values({ organizationId, proposalId: owned.proposalId, sectionId: input.sectionId, userId: input.userId, role: "note", content, replyToMessageId })
    .returning({ id: sectionChatMessages.id, createdAt: sectionChatMessages.createdAt });
  if (!row) return { ok: false, error: "Could not post the note." };
  const [author] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1);
  const targets = replyToMessageId ? await loadReplyTargets(organizationId, input.sectionId, [replyToMessageId]) : new Map<string, SectionChatReplyTarget>();
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "section_chat.note",
    resourceType: "proposal_section",
    resourceId: input.sectionId,
    metadata: { proposalId: owned.proposalId, messageId: row.id, mentions: extractMentionUserIds(content).length, replyTo: !!replyToMessageId },
  });
  return {
    ok: true,
    proposalId: owned.proposalId,
    message: {
      id: row.id,
      role: "note",
      content,
      createdAt: row.createdAt.toISOString(),
      authorName: author?.name ?? author?.email ?? "",
      isMine: true,
      stubbed: false,
      replyToMessageId,
      replyTo: replyToMessageId ? (targets.get(replyToMessageId) ?? null) : null,
    },
  };
}

/**
 * BL-FB-CHAT-MULTI — tell the teammates a message @mentions, through the
 * rules engine (`comment_mentioned`, recipients from the payload): only
 * active members of this organization, never the author. Returns how
 * many were named. Best-effort for callers; errors surface to them.
 */
export async function notifySectionChatMentions(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  messageId: string;
  actorUserId: string;
  body: string;
}): Promise<number> {
  const { organizationId } = input;
  const ids = extractMentionUserIds(input.body).filter((id) => id !== input.actorUserId);
  if (ids.length === 0) return 0;
  const [members, sectionRows, actorRows] = await Promise.all([
    db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active"), inArray(memberships.userId, ids))),
    db
      .select({ title: proposalSections.title })
      .from(proposalSections)
      .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
      .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
      .limit(1),
    db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.actorUserId)).limit(1),
  ]);
  const mentionedUserIds = members.map((m) => m.userId);
  const section = sectionRows[0];
  if (mentionedUserIds.length === 0 || !section) return 0;
  const names = await memberNames(organizationId);
  const authorName = actorRows[0] ? memberLabel(actorRows[0]) : "A teammate";
  await dispatchTriggerEvent({
    organizationId,
    kind: "comment_mentioned",
    payload: { proposalId: input.proposalId, sectionId: input.sectionId, messageId: input.messageId, source: "section_chat", mentionedUserIds },
    subject: mentionSubject(authorName, section.title),
    body: renderMentionsToPlain(input.body, (id) => names.get(id) ?? null).slice(0, 500),
    // Slice 2 — the link opens the chat scrolled to this message.
    linkPath: sectionChatLink(input.proposalId, input.sectionId, input.messageId),
    proposalId: input.proposalId,
    actorUserId: input.actorUserId,
  });
  return mentionedUserIds.length;
}

/** Delete a section's thread (and, BL-FB-CHAT-UPLOAD, its attachments); returns message rows removed. */
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
  await deleteChatAttachmentsForSection({ organizationId: input.organizationId, sectionId: input.sectionId });
  return deleted.length;
}
