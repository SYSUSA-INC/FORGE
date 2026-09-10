import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";
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
    .select({
      id: users.id,
      emailVerified: users.emailVerified,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user?.emailVerified && user.passwordHash) {
    const token = await issueToken("reset-password", email);
    try {
      await sendPasswordResetEmail(email, token);
    } catch (err) {
      log.error("[forgot-password]", "sendPasswordResetEmail failed", { error: err });
    }
  }

  return NextResponse.json({ ok: true });
}
