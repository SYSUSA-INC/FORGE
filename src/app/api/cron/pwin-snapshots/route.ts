import { NextResponse, type NextRequest } from "next/server";
import { runPwinSnapshotCron } from "@/lib/pwin-nightly";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-AIP-7b part ii — Vercel Cron handler for nightly PWin snapshots.
 *
 * Wired in vercel.json at "/api/cron/pwin-snapshots", 09:30 UTC daily
 * (after the scout). For every enabled tenant with a live opportunity:
 * compute the calibrated PWin of each live opportunity (100 per tenant)
 * and freeze it as a "nightly" snapshot when it moved since the last
 * one, or weekly as a baseline. "PWin movers" on the Command Center and
 * /intelligence read these rows. See `runPwinSnapshotCron` for budgets.
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
    log.warn("[pwin-snapshots-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runPwinSnapshotCron();
    log.info("[pwin-snapshots-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[pwin-snapshots-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
