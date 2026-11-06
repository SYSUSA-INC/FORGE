import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { postmarkInboundSchema } from "@/lib/inbound-email-logic";
import { receivePostmarkEmail } from "@/lib/inbound-email";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Postmark's inbound payload is JSON with base64 attachments; the host caps a request near 4.5 MB. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * BL-SCOUT-INBOX — Postmark's inbound webhook: the emails portals send to
 * a company's bid address on FORGE's inbound domain.
 *
 * Auth: Postmark calls `https://inbound:${INBOUND_WEBHOOK_SECRET}@<host>/api/webhooks/postmark-inbound`,
 * so the request carries HTTP basic credentials; the password is compared
 * in constant time. With no secret set the route refuses to run. A bad
 * password is 401; a payload that isn't Postmark's is 400. Anything else
 * is 200, including mail for an address FORGE doesn't know, so Postmark
 * doesn't retry what will never be accepted; a retry of a delivery FORGE
 * already holds is recognised by its MessageID.
 */
export async function POST(req: NextRequest) {
  const secret = (process.env.INBOUND_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "INBOUND_WEBHOOK_SECRET not set. Refusing to accept mail without it." }, { status: 500 });
  }
  if (!passwordMatches(req.headers.get("authorization") ?? "", secret)) {
    log.warn("[postmark-inbound]", "unauthorized call", { hasAuth: !!req.headers.get("authorization") });
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "Too large." }, { status: 413 });
  let parsed;
  try {
    parsed = postmarkInboundSchema.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "Not JSON." }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Not a Postmark inbound payload." }, { status: 400 });

  try {
    const res = await receivePostmarkEmail(parsed.data, raw);
    if (res.status === "unrouted") log.info("[postmark-inbound]", "dropped", { reason: res.reason });
    return NextResponse.json({ ok: true, status: res.status });
  } catch (err) {
    // FORGE's side failed (the database, storage): Postmark retries this delivery.
    log.error("[postmark-inbound]", "receive failed", { error: err });
    return NextResponse.json({ ok: false, error: "Could not store the email." }, { status: 500 });
  }
}

/** HTTP basic credentials whose password is the secret (any user name), compared in constant time. */
function passwordMatches(header: string, secret: string): boolean {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!m) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  } catch {
    return false;
  }
  const password = decoded.slice(decoded.indexOf(":") + 1);
  const a = Buffer.from(password);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
