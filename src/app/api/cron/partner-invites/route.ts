import { NextResponse, type NextRequest } from "next/server";
import { sweepExpiredPartnerInvites } from "@/lib/partner-invite-cron";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-NAV-LIFECYCLE 3c-3 — Vercel Cron handler for the sweep of expired
 * partner invites.
 *
 * Wired in vercel.json at "/api/cron/partner-invites", 07:50 UTC daily.
 * Retires every expired invite link (its token hash cleared, the row kept)
 * and sends a partner that was invited but never answered back to
 * *candidate*; one audit row per affected partner. See
 * `sweepExpiredPartnerInvites`.
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
    log.warn("[partner-invite-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await sweepExpiredPartnerInvites();
    if (result.errors > 0) {
      return NextResponse.json({ ok: false, error: `${result.errors} organization(s) failed; see logs.`, ...result }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[partner-invite-cron]", "cron run failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
