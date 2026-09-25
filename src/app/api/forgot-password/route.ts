import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailConfigured, sendPasswordResetEmail } from "@/lib/email";
import { issueToken } from "@/lib/tokens";
import { log } from "@/lib/log";
import { enforceRateLimit, ipFromRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // BL-TENANT-AUDIT 2026-09: unauthenticated and it sends mail, so it
  // needs the same per-IP ceiling as /api/register. Each issue also
  // invalidates the previous reset token, so an unthrottled caller could
  // both email-bomb a victim and keep cancelling their real reset link.
  const limit = await enforceRateLimit({
    key: `forgot-password:ip:${ipFromRequest(req)}`,
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many reset requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let payload: { email?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const [user] = await db
    .select({ id: users.id, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // BL-AUTH-INVITE — any live account may reset, including one created
  // through Google / Microsoft (no password yet) or one whose invite
  // acceptance never finished (no verified email yet). The emailed link
  // proves ownership of the address; /api/reset-password marks the
  // email verified when it sets the password. Refusing those accounts
  // was the "I never got a password and can't reset it" dead end.
  if (user && !user.disabledAt) {
    const token = await issueToken("reset-password", email);
    if (!emailConfigured()) {
      log.error("[forgot-password]", "reset requested but RESEND_API_KEY is not set — nothing sent", {
        userId: user.id,
      });
    } else {
      try {
        await sendPasswordResetEmail(email, token);
      } catch (err) {
        log.error("[forgot-password]", "sendPasswordResetEmail failed", { error: err });
      }
    }
  }

  // Always neutral: the response must not reveal whether the address
  // has an account.
  return NextResponse.json({ ok: true });
}
