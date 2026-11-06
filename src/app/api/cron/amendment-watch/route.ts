import { NextResponse, type NextRequest } from "next/server";
import { dispatchAmendmentWatch } from "@/lib/amendment-watch";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-SCOUT-AMEND — Vercel Cron handler for the amendment watch.
 *
 * Wired in vercel.json at "/api/cron/amendment-watch", 09:45 UTC daily,
 * after the 09:00 scout (which puts opportunities whose solicitation has a
 * new notice at the front). Checks every open opportunity with a SAM.gov
 * notice for new notices and attachments, files them and tells the team
 * (see `dispatchAmendmentWatch` for the budget and how a failing key is
 * contained).
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
    log.warn("[amendment-watch-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await dispatchAmendmentWatch();
    log.info("[amendment-watch-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[amendment-watch-cron]", "cron run failed", { error: err });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
