import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { completeForTenant } from "@/lib/ai";
import type { DraftStreamEvent } from "@/lib/ai-stream-types";
import { requireApiTenant } from "@/lib/api-tenant";
import { log } from "@/lib/log";
import {
  captureDraftSignal,
  DRAFT_MODES,
  prepareSectionDraft,
} from "@/lib/section-draft";
import { encodeSseEvent, sseHeaders } from "@/lib/sse";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { fromPlainText } from "@/lib/tiptap-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Drafts of 2200 tokens stream in well under this; the ceiling exists so
// a stalled provider cannot pin a function indefinitely.
export const maxDuration = 120;

/**
 * BL-AI-STREAMING — streamed section draft.
 *
 * Same gates, context assembly, quota semantics and draft-signal capture
 * as `generateSectionDraftAction`; the difference is the response body:
 * SSE `delta` events as text arrives, then one `done` event carrying the
 * same payload the action returns, or an `error` event. Quota and
 * telemetry are recorded by the gateway once the full text is known.
 */
const bodySchema = z.object({
  sectionId: z.string().uuid(),
  mode: z.enum(DRAFT_MODES as [string, ...string[]]),
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
  const mode = body.mode as (typeof DRAFT_MODES)[number];

  // BL-16 — feature flag + request quota, identical to the action.
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 402 });
    }
    throw err;
  }

  const prepared = await prepareSectionDraft({
    organizationId,
    sectionId: body.sectionId,
    mode,
  });
  if (!prepared.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return NextResponse.json({ ok: false, error: prepared.error }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: DraftStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeSseEvent(ev));
        } catch {
          // Client went away; keep generating so quota/telemetry stay
          // accurate, but stop trying to write.
          closed = true;
        }
      };

      try {
        const ai = await completeForTenant({
          organizationId,
          feature: "section_draft",
          variant: mode,
          system: prepared.prompt.system,
          messages: prepared.prompt.messages,
          maxTokens: prepared.maxTokens,
          temperature: prepared.temperature,
          cacheSystem: true,
          onDelta: (text) => send({ type: "delta", text }),
        });

        const text = (ai.text ?? "").trim();
        if (!text) {
          await refundQuota(organizationId, "aiRequestsPerMonth");
          send({ type: "error", error: "AI returned an empty response." });
          return;
        }

        const signalId = await captureDraftSignal({
          organizationId,
          proposalId: prepared.proposalId,
          sectionId: body.sectionId,
          createdByUserId: user.id,
          mode,
          sectionKind: prepared.sectionKind,
          draftText: text,
          stubbed: ai.stubbed,
        });

        send({
          type: "done",
          result: {
            mode,
            text,
            bodyDoc: fromPlainText(text),
            provider: ai.provider,
            model: ai.model,
            stubbed: ai.stubbed,
            inputTokens: ai.inputTokens,
            outputTokens: ai.outputTokens,
            generatedAt: new Date().toISOString(),
            signalId,
          },
        });
      } catch (err) {
        await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => {});
        log.error("[api/ai/draft]", "stream failed", { error: err });
        send({
          type: "error",
          error: err instanceof Error ? err.message : "AI request failed.",
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
