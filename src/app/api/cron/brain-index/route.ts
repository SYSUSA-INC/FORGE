import { NextResponse, type NextRequest } from "next/server";
import { runBrainIndex } from "@/lib/brain-index-cron";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-AIP-4 — Vercel Cron handler for the Brain's background indexer.
 *
 * Wired in vercel.json at "/api/cron/brain-index", thirty minutes past
 * every sixth hour.
 *
 * Reconciles outcome labels, embeds artifacts and entries that have no
 * (or stub) vectors, and auto-extracts candidates from artifacts nobody
 * has mined yet. See `runBrainIndex` for budgets.
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
    log.warn("[brain-index-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runBrainIndex();
    log.info("[brain-index-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[brain-index-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
