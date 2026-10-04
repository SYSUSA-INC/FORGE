import { NextResponse } from "next/server";
import { HONEYPOT_FIELD, signupBotSignal } from "@/lib/account-hygiene-logic";
import { log } from "@/lib/log";
import { enforceRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { submitTrialRequest } from "@/lib/trial-requests";
import { validateTrialRequest } from "@/lib/trial-request-logic";

export const runtime = "nodejs";

/**
 * BL-AUTH-ABUSE Slice 2b — the public Request-a-trial endpoint. Queues a
 * request for a platform admin; never creates an account or a workspace.
 * Company email only; same bot checks as self-service sign-up (honeypot
 * and fill time answered with a fake success); 3 requests per IP per hour.
 */
export async function POST(req: Request) {
  try {
    const ip = ipFromRequest(req);
    const limit = await enforceRateLimit({ key: `trial-request:ip:${ip}`, limit: 3, windowSeconds: 3600 });
    if (!limit.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests from this network. Try again in an hour." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    }

    const bot = signupBotSignal({ honeypot: payload[HONEYPOT_FIELD], elapsedMs: payload.elapsedMs });
    if (bot) {
      log.warn("[trial-request]", "request dropped as automated", { signal: bot, ip });
      return NextResponse.json({ ok: true });
    }

    const checked = validateTrialRequest(payload);
    if (!checked.ok) {
      return NextResponse.json({ ok: false, field: checked.field, error: checked.error }, { status: 400 });
    }

    const outcome = await submitTrialRequest({ value: checked.value, sourceIp: ip });
    if (outcome.kind === "owned_domain") {
      return NextResponse.json(
        {
          ok: false,
          field: "email",
          error: `Your organization (${outcome.organizationName}) is already on FORGE. Ask its admin to invite you.`,
        },
        { status: 409 },
      );
    }
    // Queued, or already waiting from an earlier request — the same answer either way.
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("[trial-request]", "unhandled error", { error: err });
    return NextResponse.json({ ok: false, error: "Unexpected server error. Please try again." }, { status: 500 });
  }
}
