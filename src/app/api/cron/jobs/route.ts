import { NextResponse, type NextRequest } from "next/server";
import { collectAiBatches } from "@/lib/ai-batch-queue";
import { runJobsCron } from "@/lib/jobs";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-AIP-4c — Vercel Cron handler for durable background jobs.
 *
 * Wired in vercel.json at "/api/cron/jobs", every five minutes.
 *
 * Re-queues `running` rows whose instance died (stuck past the window,
 * failed once their attempts are spent) and runs due `queued` rows —
 * solicitation parses, companion-document parses and proposal harvests
 * — from the stored file bytes, three per tick inside a time budget.
 * See `runJobsCron`. First it reads any finished AI batches (BL-AIX
 * Phase 1g-2, `collectAiBatches`), inside a minute of its own.
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
    log.warn("[jobs-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const batches = await collectAiBatches({ budgetMs: 60_000 }).catch((err) => {
      log.error("[jobs-cron]", "AI batch collection failed", { error: err });
      return null;
    });
    const result = await runJobsCron({ budgetMs: 180_000 });
    log.info("[jobs-cron]", "tick complete", { ...result, batches });
    return NextResponse.json({ ok: true, ...result, batches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[jobs-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
