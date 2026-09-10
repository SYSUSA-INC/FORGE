"use server";

import { completeForTenant } from "@/lib/ai";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  CHAT_MAX_TOKENS,
  CHAT_RATE_LIMIT,
  CHAT_TEMPERATURE,
  prepareSectionChat,
} from "@/lib/section-chat";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatWithSectionResult =
  | { ok: true; reply: string; stubbed: boolean }
  | { ok: false; error: string };

/**
 * Non-streaming section chat. The interactive panel streams through
 * /api/ai/chat; both paths share `prepareSectionChat` so the prompt and
 * context cannot drift (BL-AI-STREAMING).
 */
export async function chatWithSectionAction(input: {
  sectionId: string;
  message: string;
  history: ChatMessage[];
}): Promise<ChatWithSectionResult> {
  await requireAuth();
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

  const prepared = await prepareSectionChat({
    organizationId,
    sectionId: input.sectionId,
    history: input.history,
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

    return { ok: true, reply: res.text.trim(), stubbed: res.stubbed };
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[chatWithSectionAction]", "AI call failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Chat request failed.",
    };
  }
}
