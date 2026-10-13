import { NextResponse, type NextRequest } from "next/server";
import { collectAiBatches } from "@/lib/ai-batch-queue";
import { runJobsCron } from "@/lib/jobs";
import { log } from "@/lib/log";
import { sweepUploads } from "@/lib/uploads";

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
 * Phase 1g-2, `collectAiBatches`), inside a minute of its own, then
 * sweeps the upload ledger (BL-STAB-2d, `sweepUploads`) inside 15
 * seconds: uploads never filed are deleted, filings that died are
 * settled. Budgets: 60 + 15 + 165 s, inside the 300 s limit.
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
    const uploads = await sweepUploads({ budgetMs: 15_000, limit: 200 }).catch((err) => {
      log.error("[jobs-cron]", "upload sweep failed", { error: err });
      return null;
    });
    const result = await runJobsCron({ budgetMs: 165_000 });
    log.info("[jobs-cron]", "tick complete", { ...result, batches, uploads });
    return NextResponse.json({ ok: true, ...result, batches, uploads });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[jobs-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
