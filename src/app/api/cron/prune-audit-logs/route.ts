import { NextResponse, type NextRequest } from "next/server";
import { pruneAuditLogsAcrossTenants } from "@/lib/audit-log";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-12c — Vercel Cron handler for the daily audit-log prune.
 *
 * Wired in vercel.json:
 *   { "path": "/api/cron/prune-audit-logs", "schedule": "30 3 * * *" }
 *
 * Fires at 03:30 UTC daily — half an hour after the cert refresh
 * cron's monthly run so the two never overlap on the first of the
 * month. The route deletes any audit_log row older than the owning
 * tenant's `organization.audit_retention_days` window. Tenants
 * default to 365 days; admins adjust under /settings.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` (Vercel Cron
 * sends this automatically). Same posture as the cert cron.
 */
export async function GET(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET not set. Cron auth is required — refusing to run the prune open-bar.",
      },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (auth !== expected) {
    log.warn("[audit-prune-cron]", "unauthorized call", {
      hasAuth: auth.length > 0,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await pruneAuditLogsAcrossTenants();
    log.info("[audit-prune-cron]", "prune complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[audit-prune-cron]", "cron run failed", { error: message });
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
