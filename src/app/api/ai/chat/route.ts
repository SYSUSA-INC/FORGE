import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { completeForTenant } from "@/lib/ai";
import type { ChatStreamEvent } from "@/lib/ai-stream-types";
import { requireApiTenant } from "@/lib/api-tenant";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  appendSectionChatTurns,
  CHAT_MAX_TOKENS,
  CHAT_RATE_LIMIT,
  CHAT_TEMPERATURE,
  findSectionForOrg,
  loadSectionChatModelHistory,
  prepareSectionChat,
} from "@/lib/section-chat";
import { encodeSseEvent, sseHeaders } from "@/lib/sse";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-AI-STREAMING — streamed section chat.
 *
 * Same gates, rate limit and prompt as `chatWithSectionAction`; streams
 * the reply as SSE `delta` events and finishes with `done` (or `error`).
 *
 * BL-FB-CHAT-PERSIST — model history is read from the section's
 * persisted thread (the server decides what the model sees), and the
 * exchange is appended to the thread before `done` is sent so a
 * subsequent history load is consistent with what the user just saw.
 */
const bodySchema = z.object({
  sectionId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
});

export async function POST(req: NextRequest) {
  const tenant = await requireApiTenant();
  if (!tenant.ok) return tenant.response;
  const { user, organizationId } = tenant.ctx;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 402 });
    }
    throw err;
  }

  // BL-TENANT-AUDIT 2026-09: verify the section belongs to this tenant
  // before spending the per-section rate limit, and key the limit by
  // tenant, so one org can never burn another org's chat budget.
  const owned = await findSectionForOrg({ organizationId, sectionId: body.sectionId });
  if (!owned) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return NextResponse.json({ ok: false, error: "Section not found." }, { status: 404 });
  }

  const limit = await enforceRateLimit({
    key: `section-chat:${organizationId}:${body.sectionId}`,
    ...CHAT_RATE_LIMIT,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return NextResponse.json(
      {
        ok: false,
        error: `Chat limit reached (${CHAT_RATE_LIMIT.limit}/hour per section). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
      },
      { status: 429 },
    );
  }

  const history = await loadSectionChatModelHistory({
    organizationId,
    sectionId: body.sectionId,
  });
  const prepared = await prepareSectionChat({
    organizationId,
    sectionId: body.sectionId,
    history,
    message: body.message,
  });
  if (!prepared.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return NextResponse.json({ ok: false, error: prepared.error }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeSseEvent(ev));
        } catch {
          closed = true;
        }
      };

      try {
        const ai = await completeForTenant({
          organizationId,
          feature: "section_chat",
          system: prepared.system,
          messages: prepared.messages,
          maxTokens: CHAT_MAX_TOKENS,
          temperature: CHAT_TEMPERATURE,
          cacheSystem: false,
          onDelta: (text) => send({ type: "delta", text }),
        });
        const reply = ai.text.trim();

        if (reply) {
          try {
            await appendSectionChatTurns({
              organizationId,
              proposalId: prepared.proposalId,
              sectionId: body.sectionId,
              userId: user.id,
              userMessage: body.message,
              assistantReply: reply,
              stubbed: ai.stubbed,
            });
          } catch (err) {
            log.warn("[api/ai/chat]", "thread persist failed", { error: err });
          }
        }

        send({ type: "done", reply, stubbed: ai.stubbed });
      } catch (err) {
        await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => {});
        log.error("[api/ai/chat]", "stream failed", { error: err });
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Chat request failed.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
