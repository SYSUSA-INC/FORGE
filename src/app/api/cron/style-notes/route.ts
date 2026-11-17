import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";
import { runStyleNoteCron } from "@/lib/style-note";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-NAV-LIFECYCLE 5d-2 — Vercel Cron handler for the weekly style notes.
 *
 * Wired in vercel.json at "/api/cron/style-notes", Mondays 08:23 UTC. For
 * every enabled tenant with tracked-change decisions in the last 180 days:
 * rebuild one note per section kind from that tenant's own edits (what was
 * cut, what was added, the wording preferred). No AI call. See
 * `runStyleNoteCron` for the budget.
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
    log.warn("[style-notes-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runStyleNoteCron();
    log.info("[style-notes-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[style-notes-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
