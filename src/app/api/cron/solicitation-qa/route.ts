import { NextResponse, type NextRequest } from "next/server";
import { dispatchSolicitationQaPolls } from "@/lib/solicitation-qa";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-STAB-7d — Vercel Cron handler for the daily Q&A check.
 *
 * Wired in vercel.json at "/api/cron/solicitation-qa", 08:15 UTC daily.
 * Polls the SAM.gov notices of live solicitations for new Q&A, each on
 * its company's key (see `dispatchSolicitationQaPolls` for the budget and
 * how a failing key is contained). It used to share the 60 s key-date
 * tick, where a few slow SAM.gov answers ran out its time.
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
    log.warn("[solicitation-qa-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await dispatchSolicitationQaPolls();
    log.info("[solicitation-qa-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[solicitation-qa-cron]", "cron run failed", { error: err });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
