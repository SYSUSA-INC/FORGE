import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { captureProductionError } from "@/lib/error-log";

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
 * Rate limiting: piggy-backs on Vercel's per-IP edge limits — a flood
 * of client-side errors from one IP gets dropped at the edge before
 * hitting this handler. We also dedupe by fingerprint inside
 * captureProductionError, so a runaway client-side loop firing the
 * same error 1000 times collapses into 1 row.
 *
 * Returns 204 in all cases (including parse errors) so the client
 * never sees an error from the error-report endpoint itself — that'd
 * be unhelpful noise during an already-broken page render.
 */
export async function POST(req: NextRequest) {
  try {
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
    });
  } catch {
    // Swallow. Returning 204 unconditionally — see header comment.
  }

  return new NextResponse(null, { status: 204 });
}
