import { NextResponse, type NextRequest } from "next/server";
import { processSlaBreaches } from "@/lib/notification-cron";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-13 Phase D — Vercel Cron handler for SLA breach + escalation.
 *
 * Wired in vercel.json:
 *   { "path": "/api/cron/notification-sla", "schedule": "*\/15 * * * *" }
 *
 * Fires every 15 minutes — SLA windows are typically measured in
 * hours, so a 15-min granularity gives reasonable precision without
 * spinning the function constantly.
 *
 * Auth: Bearer ${CRON_SECRET}, same as the other cron routes.
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
    log.warn("[notification-sla-cron]", "unauthorized call", {
      hasAuth: auth.length > 0,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await processSlaBreaches();
    log.info("[notification-sla-cron]", "sla pass complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[notification-sla-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
