import { NextResponse, type NextRequest } from "next/server";
import { dispatchKeyDateReminders } from "@/lib/solicitation-key-date-cron";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-FB-SOL-CALENDAR — Vercel Cron handler for key-date reminders.
 *
 * Wired in vercel.json:
 *   { "path": "/api/cron/solicitation-key-dates", "schedule": "0 8 * * *" }
 *
 * Fires daily at 08:00 UTC. Scans all solicitations with stored keyDates,
 * finds dates exactly 1, 3, or 7 days away from today, and sends in-app
 * notifications to all assigned team members.
 *
 * Auth: Bearer ${CRON_SECRET} — same pattern as all other cron routes.
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
    log.warn("[solicitation-key-date-cron]", "unauthorized call", {
      hasAuth: auth.length > 0,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await dispatchKeyDateReminders();
    log.info("[solicitation-key-date-cron]", "dispatch complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[solicitation-key-date-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
