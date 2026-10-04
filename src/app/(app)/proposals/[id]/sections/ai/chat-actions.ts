"use server";

import { revalidatePath } from "next/cache";
import { completeForTenant } from "@/lib/ai";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { expandSlashCommand } from "@/lib/chat-commands";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  attachChatDocument,
  listChatAttachments,
  removeChatAttachment,
  saveChatAttachmentToKnowledge,
  type ChatAttachmentView,
} from "@/lib/section-chat-attachments";
import {
  appendSectionChatNote,
  appendSectionChatTurns,
  CHAT_MAX_TOKENS,
  CHAT_RATE_LIMIT,
  CHAT_TEMPERATURE,
  clearSectionChat,
  findSectionForOrg,
  loadSectionChatModelHistory,
  loadSectionChatThread,
  markSectionChatRead,
  notifySectionChatMentions,
  prepareSectionChat,
  setSectionChatNotesToModel,
  type SectionChatReplyTarget,
  type SectionChatTurn,
} from "@/lib/section-chat";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";

export type ChatMessage = {
  /** BL-FB-CHAT-MULTI — "note" is a teammate's message that called no model. */
  role: "user" | "assistant" | "note";
  content: string;
  /** BL-FB-CHAT-PERSIST — author of a user turn when it is not the viewer. */
  authorName?: string;
  isMine?: boolean;
  /** BL-FB-CHAT-MULTI Slice 2 — persisted id and time (absent on an optimistic turn), and the message this one answers. */
  id?: string;
  createdAt?: string;
  replyToMessageId?: string | null;
  replyTo?: SectionChatReplyTarget | null;
};

export type { ChatAttachmentView } from "@/lib/section-chat-attachments";

/**
 * BL-FB-CHAT-UPLOAD — attach a document to this section's conversation.
 * Any member who can chat may attach; the text stays with the thread.
 */
export async function attachChatDocumentAction(
  formData: FormData,
): Promise<{ ok: true; attachment: ChatAttachmentView } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const file = formData.get("file");
  const sectionId = String(formData.get("sectionId") ?? "");
  if (!(file instanceof File)) return { ok: false, error: "Pick a file to attach." };
  try {
    return await attachChatDocument({
      organizationId,
      sectionId,
      fileName: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor: { userId: user.id, email: user.email },
    });
  } catch (err) {
    log.error("[attachChatDocumentAction]", "error", { error: err });
    return { ok: false, error: err instanceof Error ? err.message : "Could not attach the file." };
  }
}

export async function listChatAttachmentsAction(
  sectionId: string,
): Promise<{ ok: true; attachments: ChatAttachmentView[] } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return { ok: true, attachments: await listChatAttachments({ organizationId, sectionId: String(sectionId ?? "") }) };
}

export async function removeChatAttachmentAction(
  attachmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return removeChatAttachment({
    organizationId,
    attachmentId: String(attachmentId ?? ""),
    actor: { userId: user.id, email: user.email },
  });
}

export async function saveChatAttachmentToKnowledgeAction(
  attachmentId: string,
): Promise<{ ok: true; artifactId: string; embedded: boolean } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await saveChatAttachmentToKnowledge({
    organizationId,
    attachmentId: String(attachmentId ?? ""),
    actor: { userId: user.id, email: user.email },
  });
  if (res.ok) revalidatePath("/knowledge-base/import");
  return res;
}

export type ChatWithSectionResult =
  | { ok: true; reply: string; stubbed: boolean }
  | { ok: false; error: string };

/**
 * Non-streaming section chat. The interactive panel streams through
 * /api/ai/chat; both paths share `prepareSectionChat` so the prompt and
 * context cannot drift (BL-AI-STREAMING), and both persist the exchange
 * to the section's thread (BL-FB-CHAT-PERSIST). Model history comes from
 * the persisted thread; a caller-supplied `history` is accepted for
 * compatibility but not used.
 */
export async function chatWithSectionAction(input: {
  sectionId: string;
  message: string;
  history?: ChatMessage[];
  /** BL-FB-CHAT-MULTI Slice 2 — the thread message this question answers. */
  replyToMessageId?: string | null;
}): Promise<ChatWithSectionResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // BL-FB-CHAT-SLASH — a malformed command is refused before any gate is spent.
  const slash = expandSlashCommand(String(input.message ?? ""));
  if (slash && !slash.ok) return { ok: false, error: slash.error };

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  // BL-TENANT-AUDIT 2026-09: verify the section belongs to this tenant
  // before spending the per-section rate limit, and key the limit by
  // tenant, so one org can never burn another org's chat budget.
  const owned = await findSectionForOrg({ organizationId, sectionId: input.sectionId });
  if (!owned) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: "Section not found." };
  }

  const limit = await enforceRateLimit({
    key: `section-chat:${organizationId}:${input.sectionId}`,
    ...CHAT_RATE_LIMIT,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Chat limit reached (${CHAT_RATE_LIMIT.limit}/hour per section). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  const history = await loadSectionChatModelHistory({
    organizationId,
    sectionId: input.sectionId,
  });
  const prepared = await prepareSectionChat({
    organizationId,
    sectionId: input.sectionId,
    history,
    message: input.message,
  });
  if (!prepared.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: prepared.error };
  }

  try {
    const res = await completeForTenant({
      organizationId,
      feature: "section_chat",
      system: prepared.system,
      messages: prepared.messages,
      maxTokens: CHAT_MAX_TOKENS,
      temperature: CHAT_TEMPERATURE,
      cacheSystem: false,
    });
    const reply = res.text.trim();

    if (reply) {
      try {
        const ids = await appendSectionChatTurns({
          organizationId,
          proposalId: prepared.proposalId,
          sectionId: input.sectionId,
          userId: user.id,
          userMessage: input.message,
          assistantReply: reply,
          stubbed: res.stubbed,
          replyToMessageId: input.replyToMessageId ?? null,
        });
        // BL-FB-CHAT-MULTI — teammates named in the question hear about it.
        await notifySectionChatMentions({
          organizationId,
          proposalId: prepared.proposalId,
          sectionId: input.sectionId,
          messageId: ids.userMessageId,
          actorUserId: user.id,
          body: input.message,
        });
      } catch (err) {
        log.warn("[chatWithSectionAction]", "thread persist failed", { error: err });
      }
    }

    return { ok: true, reply, stubbed: res.stubbed };
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[chatWithSectionAction]", "AI call failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Chat request failed.",
    };
  }
}

export type PostNoteResult = { ok: true; message: SectionChatTurn } | { ok: false; error: string };

/**
 * BL-FB-CHAT-MULTI — post a note to the team on this section's thread
 * without asking the AI; anyone it @mentions is notified.
 */
export async function postSectionChatNoteAction(input: { sectionId: string; content: string; replyToMessageId?: string | null }): Promise<PostNoteResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await appendSectionChatNote({
    organizationId,
    sectionId: String(input.sectionId ?? ""),
    userId: user.id,
    content: String(input.content ?? ""),
    replyToMessageId: typeof input.replyToMessageId === "string" ? input.replyToMessageId : null,
    actor: { userId: user.id, email: user.email },
  });
  if (!res.ok) return res;
  try {
    await notifySectionChatMentions({
      organizationId,
      proposalId: res.proposalId,
      sectionId: input.sectionId,
      messageId: res.message.id,
      actorUserId: user.id,
      body: res.message.content,
    });
  } catch (err) {
    log.warn("[postSectionChatNoteAction]", "mention notify failed", { error: err });
  }
  return { ok: true, message: res.message };
}

export type SectionChatHistoryResult =
  | { ok: true; messages: SectionChatTurn[]; lastReadAt: string | null; notesToModel: boolean }
  | { ok: false; error: string };

/**
 * BL-FB-CHAT-PERSIST — the section's thread for display, oldest first;
 * Slice 2 adds when the viewer last looked and whether the model reads
 * the team's notes here.
 */
export async function getSectionChatHistoryAction(
  sectionId: string,
): Promise<SectionChatHistoryResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const thread = await loadSectionChatThread({
    organizationId,
    sectionId,
    viewerUserId: user.id,
  });
  if (!thread) return { ok: false, error: "Section not found." };
  return { ok: true, ...thread };
}

/** BL-FB-CHAT-MULTI Slice 2 — the viewer has looked at this thread now. */
export async function markSectionChatReadAction(
  sectionId: string,
): Promise<{ ok: true; lastReadAt: string } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return markSectionChatRead({ organizationId, sectionId: String(sectionId ?? ""), userId: user.id });
}

/** BL-FB-CHAT-MULTI Slice 2 — let the chat model read (or stop reading) this section's team notes. */
export async function setSectionChatNotesToModelAction(
  sectionId: string,
  enabled: boolean,
): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return setSectionChatNotesToModel({
    organizationId,
    sectionId: String(sectionId ?? ""),
    enabled: enabled === true,
    actor: { userId: user.id, email: user.email },
  });
}

export type ClearSectionChatResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string };

/** BL-FB-CHAT-PERSIST — delete the section's thread. Audited. */
export async function clearSectionChatAction(
  sectionId: string,
): Promise<ClearSectionChatResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const owned = await findSectionForOrg({ organizationId, sectionId });
  if (!owned) return { ok: false, error: "Section not found." };

  const deleted = await clearSectionChat({ organizationId, sectionId });

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "section_chat.clear",
    resourceType: "proposal_section",
    resourceId: sectionId,
    metadata: { proposalId: owned.proposalId, deleted },
  });

  return { ok: true, deleted };
}
