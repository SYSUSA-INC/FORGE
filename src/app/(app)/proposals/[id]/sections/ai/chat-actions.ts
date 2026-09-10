"use server";

import { completeForTenant } from "@/lib/ai";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  appendSectionChatTurns,
  CHAT_MAX_TOKENS,
  CHAT_RATE_LIMIT,
  CHAT_TEMPERATURE,
  clearSectionChat,
  findSectionForOrg,
  loadSectionChatHistory,
  loadSectionChatModelHistory,
  prepareSectionChat,
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
  role: "user" | "assistant";
  content: string;
  /** BL-FB-CHAT-PERSIST — author of a user turn when it is not the viewer. */
  authorName?: string;
  isMine?: boolean;
};

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
}): Promise<ChatWithSectionResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const limit = await enforceRateLimit({
    key: `section-chat:${input.sectionId}`,
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
        await appendSectionChatTurns({
          organizationId,
          proposalId: prepared.proposalId,
          sectionId: input.sectionId,
          userId: user.id,
          userMessage: input.message,
          assistantReply: reply,
          stubbed: res.stubbed,
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

export type SectionChatHistoryResult =
  | { ok: true; messages: SectionChatTurn[] }
  | { ok: false; error: string };

/** BL-FB-CHAT-PERSIST — the section's thread for display, oldest first. */
export async function getSectionChatHistoryAction(
  sectionId: string,
): Promise<SectionChatHistoryResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const messages = await loadSectionChatHistory({
    organizationId,
    sectionId,
    viewerUserId: user.id,
  });
  return { ok: true, messages };
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
