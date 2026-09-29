import { NextResponse, type NextRequest } from "next/server";
import { runScoutCron } from "@/lib/scout";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-AIP-7b — Vercel Cron handler for the nightly scout.
 *
 * Wired in vercel.json at "/api/cron/scout", 09:00 UTC daily (before
 * the US working day). For every enabled tenant not scouted in the last
 * twenty hours: re-run its NAICS codes and keywords against SAM.gov,
 * turn watchlisted awards ending within six months into recompete
 * candidates, score each find against the tenant's history and triage
 * the best ten with the model. See `runScoutCron` for budgets.
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
    log.warn("[scout-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runScoutCron();
    log.info("[scout-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[scout-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
