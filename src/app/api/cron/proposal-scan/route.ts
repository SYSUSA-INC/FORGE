import { NextResponse, type NextRequest } from "next/server";
import { runStaleProposalScans } from "@/lib/proposal-scan-cron";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-FB-SCAN-CONTINUOUS — Vercel Cron handler for background proposal
 * health scans.
 *
 * Wired in vercel.json:
 *   { "path": "/api/cron/proposal-scan", "schedule": "every-5-minutes" }
 *
 * Fires every 5 minutes. Finds proposals that have been dirty for ≥ 5
 * minutes (generous window avoids racing with the 65s client-side
 * debounce) and runs up to 5 scans per invocation. Oldest-dirty-first
 * so no proposal is perpetually starved when the batch cap is hit.
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
    log.warn("[proposal-scan-cron]", "unauthorized call", {
      hasAuth: auth.length > 0,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await runStaleProposalScans(5);
    log.info("[proposal-scan-cron]", "batch complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[proposal-scan-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
