import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { captureProductionError } from "@/lib/error-log";
import { enforceRateLimit, ipFromRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BL-QC-errors — client-side error report endpoint.
 *
 * Receives a JSON payload from the global error boundary
 * (`src/app/global-error.tsx`) and persists it via
 * `captureProductionError`. Auth-optional — pre-auth crashes (sign-in
 * page errors, etc.) still get logged, just without user/org context.
 *
 * Rate limiting: a per-IP ceiling inside the handler (BL-TENANT-AUDIT
 * 2026-09) on top of Vercel's edge limits, because the fingerprint used
 * for dedupe inside captureProductionError is built from caller-
 * supplied fields and an anonymous client could otherwise fill the
 * table with distinct rows. Over the limit we still return 204 — the
 * report is simply dropped.
 *
 * Returns 204 in all cases (including parse errors) so the client
 * never sees an error from the error-report endpoint itself — that'd
 * be unhelpful noise during an already-broken page render.
 */
export async function POST(req: NextRequest) {
  try {
    const limit = await enforceRateLimit({
      key: `error-report:ip:${ipFromRequest(req)}`,
      limit: 60,
      windowSeconds: 3600,
    });
    if (!limit.ok) return new NextResponse(null, { status: 204 });

    const body = (await req.json()) as {
      message?: unknown;
      stack?: unknown;
      digest?: unknown;
      path?: unknown;
      userAgent?: unknown;
    };

    const message =
      typeof body.message === "string" && body.message.length > 0
        ? body.message
        : "Client error";
    const stack = typeof body.stack === "string" ? body.stack : "";
    const path = typeof body.path === "string" ? body.path : "";
    const userAgent =
      typeof body.userAgent === "string" ? body.userAgent : "";
    // React's error digest — same value across deploys for the same
    // underlying server-side error. Included in the captured row's
    // fingerprint so distinct server-side bugs don't collapse into one
    // row just because Next.js production hides the message.
    const digest = typeof body.digest === "string" ? body.digest : "";

    // Look up user context if the request carries a session.
    // Never required — pre-auth errors still get captured.
    // organizationId stays null because the client session payload
    // doesn't include it; server-side captures (future) populate it.
    const organizationId: string | null = null;
    let userId: string | null = null;
    try {
      const session = await auth();
      userId = session?.user?.id ?? null;
    } catch {
      // No session, no problem.
    }

    await captureProductionError({
      error: { message, stack } as Error,
      runtime: "client",
      organizationId,
      userId,
      requestPath: path,
      requestMethod: "GET", // best guess — client error was during page render
      userAgent,
      digest,
    });
  } catch {
    // Swallow. Returning 204 unconditionally — see header comment.
  }

  return new NextResponse(null, { status: 204 });
}
