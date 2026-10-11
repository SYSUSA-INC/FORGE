import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";
import { runSamNoticeLoad } from "@/lib/sam-notice-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-STAB-10b — Vercel Cron handler for FORGE's copy of SAM.gov's public
 * notice descriptions (`runSamNoticeLoad`). Wired in vercel.json at
 * 04:20, 06:20 and 08:20 UTC: SAM.gov publishes the file overnight, an
 * unchanged file costs one 304, and a later tick finishes a run that was
 * cut short. All before the 09:00 scout.
 *
 * Auth: Bearer ${CRON_SECRET} — same pattern as all other cron routes.
 */
export async function GET(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not set. Cron auth is required — refusing to run open-bar." }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${cronSecret}`) {
    log.warn("[sam-notices-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runSamNoticeLoad();
    log.info("[sam-notices-cron]", "run complete", result);
    return NextResponse.json({ ok: result.status !== "failed" && result.status !== "rejected", ...result });
  } catch (err) {
    log.error("[sam-notices-cron]", "run failed", { error: err });
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
