import { NextResponse, type NextRequest } from "next/server";
import { refreshWatchedAgencies } from "@/lib/crm-history";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-FB-X-CRM Slice 4 — Vercel Cron handler, 04:45 UTC daily (vercel.json).
 * Refreshes the USAspending procurement history of the agencies teams
 * have contacts at, so Customer contacts opens warm. At most
 * AGENCY_REFRESH_PER_RUN agencies a night across all tenants; skipped
 * while AWARDS_INTEL_ENABLED is off.
 *
 * Auth: Bearer ${CRON_SECRET} — same pattern as all other cron routes.
 */
export async function GET(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not set. Cron auth is required — refusing to run open-bar." }, { status: 500 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
    log.warn("[crm-agency-refresh-cron]", "unauthorized call", { hasAuth: !!req.headers.get("authorization") });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await refreshWatchedAgencies();
    log.info("[crm-agency-refresh-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[crm-agency-refresh-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
