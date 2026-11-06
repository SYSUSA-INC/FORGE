import { NextResponse, type NextRequest } from "next/server";
import { pollInboundMailbox } from "@/lib/inbound-graph";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * BL-SCOUT-INBOX — Vercel Cron handler that reads FORGE's shared Exchange
 * mailbox (Microsoft Graph) for the emails portals send to companies' bid
 * addresses. Wired in vercel.json at "/api/cron/inbound-mail", every two
 * minutes. Does nothing until the Graph settings are set (ADMIN_MANUAL §3.7).
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
    log.warn("[inbound-mail-cron]", "unauthorized call", { hasAuth: auth.length > 0 });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await pollInboundMailbox();
    log.info("[inbound-mail-cron]", "run complete", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[inbound-mail-cron]", "cron run failed", { error: err });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
