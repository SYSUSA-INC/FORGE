import { NextResponse, type NextRequest } from "next/server";
import { runCertRefreshFromCron } from "@/app/(app)/admin/sba-8a/actions";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel's free-tier function timeout is 60s. Pro is 300s. The
// refresh job is paginated to fit in 60s; bump this only if the
// project moves to Pro and we need to lift CRON_PAGES_PER_CERT.
export const maxDuration = 60;

/**
 * Vercel Cron handler.
 *
 * Wired up in vercel.json:
 *   { "path": "/api/cron/refresh-certifications", "schedule": "0 3 1 * *" }
 *
 * That fires the route at 03:00 UTC on the first of each month. The
 * route does two things:
 *   1. Refresh — for every CERT_SPEC with verified: true, pull the
 *      first N pages from SAM.gov and upsert into cert_firm. Catches
 *      new firms and updates lapsed certifications.
 *   2. Prune — delete any cert_firm rows where status='graduated' and
 *      cert_exit_date is older than the configured retention window
 *      (default 36 months, configurable via /admin/sba-8a).
 *
 * Auth: Vercel Cron always sends `Authorization: Bearer <CRON_SECRET>`
 * where CRON_SECRET is an env var we set on the Vercel project. We
 * reject any call that doesn't carry it. Manual `curl` calls from
 * outside Vercel won't fire the job.
 *
 * Set CRON_SECRET to a long random value in Vercel → Settings →
 * Environment Variables (Production scope). Save and redeploy.
 */
export async function GET(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET not set. Cron auth is required — refusing to run the refresh open-bar.",
      },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (auth !== expected) {
    log.warn("[cert-cron]", "unauthorized call", {
      hasAuth: auth.length > 0,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await runCertRefreshFromCron();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[cert-cron]", "cron run failed", { error: message });
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
