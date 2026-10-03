import { NextResponse, type NextRequest } from "next/server";
import { requireApiTenant } from "@/lib/api-tenant";
import { DICTATION_LIMITS, TRANSCRIBE_ACCEPTED } from "@/lib/dictation";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { transcribeAudio, transcriptionConfig } from "@/lib/transcription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * BL-FB-CHAT-VOICE — transcribe a short microphone clip for browsers
 * without the Web Speech API. Same tenant gate and request quota as the
 * chat it feeds; per-user rate limit; the clip is never stored. GET says
 * whether a provider is configured so the client can offer the fallback.
 */
const RATE_LIMIT = { limit: 60, windowSeconds: 3600 } as const;

export async function GET() {
  const tenant = await requireApiTenant();
  if (!tenant.ok) return tenant.response;
  const cfg = transcriptionConfig();
  return NextResponse.json({ ok: true, configured: cfg !== null, provider: cfg?.provider ?? null });
}

export async function POST(req: NextRequest) {
  const tenant = await requireApiTenant();
  if (!tenant.ok) return tenant.response;
  const { user, organizationId } = tenant.ctx;

  if (!transcriptionConfig()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This browser cannot transcribe speech itself and no transcription provider is configured on the server. Use Chrome, Edge or Safari, or ask an admin to set TRANSCRIPTION_API_URL and TRANSCRIPTION_API_KEY.",
      },
      { status: 503 },
    );
  }

  let audio: File | null = null;
  let durationMs = 0;
  let language = "";
  try {
    const form = await req.formData();
    const f = form.get("audio");
    audio = f instanceof File ? f : null;
    durationMs = Number(form.get("durationMs") ?? 0);
    language = String(form.get("language") ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  if (!audio || audio.size === 0) return NextResponse.json({ ok: false, error: "No audio received." }, { status: 400 });
  if (audio.size > DICTATION_LIMITS.maxBytes) {
    return NextResponse.json({ ok: false, error: "The clip is too large. Dictate in shorter pieces." }, { status: 413 });
  }
  if (!TRANSCRIBE_ACCEPTED.test(audio.type)) {
    return NextResponse.json({ ok: false, error: `Unsupported audio type (${audio.type || "unknown"}).` }, { status: 415 });
  }
  if (Number.isFinite(durationMs) && durationMs > DICTATION_LIMITS.maxSeconds * 1000 + 2_000) {
    return NextResponse.json({ ok: false, error: `Clips are limited to ${DICTATION_LIMITS.maxSeconds} seconds.` }, { status: 413 });
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

  const limit = await enforceRateLimit({ key: `transcribe:${organizationId}:${user.id}`, ...RATE_LIMIT });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return NextResponse.json(
      { ok: false, error: `Dictation limit reached (${RATE_LIMIT.limit}/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.` },
      { status: 429 },
    );
  }

  const res = await transcribeAudio({
    bytes: await audio.arrayBuffer(),
    contentType: audio.type,
    fileName: audio.name || "clip.webm",
    language,
  });
  if (!res.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => {});
    return NextResponse.json({ ok: false, error: res.error }, { status: res.status && res.status >= 500 ? 502 : 400 });
  }
  log.info("[api/ai/transcribe]", "clip transcribed", {
    organizationId,
    provider: res.provider,
    bytes: audio.size,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    chars: res.text.length,
  });
  return NextResponse.json({ ok: true, text: res.text });
}
