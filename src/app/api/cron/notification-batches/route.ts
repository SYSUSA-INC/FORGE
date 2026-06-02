import { NextResponse, type NextRequest } from "next/server";
import { materializeNotificationBatches } from "@/lib/notification-cron";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-13 Phase D — Vercel Cron handler for batched-frequency
 * notification materialization.
 *
 * Wired in vercel.json:
 *   { "path": "/api/cron/notification-batches", "schedule": "0 4 * * *" }
 *
 * Fires at 04:00 UTC daily — offset from the audit-log prune (03:30 UTC)
 * and the cert refresh (03:00 UTC on the 1st) so they don't overlap.
 *
 * Auth: same Bearer ${CRON_SECRET} pattern as the other cron routes.
 */
export async function GET(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET not set. Cron auth is required — refusing to run open-bar.",
      },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (auth !== expected) {
    log.warn("[notification-batches-cron]", "unauthorized call", {
      hasAuth: auth.length > 0,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await materializeNotificationBatches();
    log.info("[notification-batches-cron]", "materialization complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[notification-batches-cron]", "cron run failed", {
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
