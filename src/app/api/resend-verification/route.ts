import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailConfigured, sendVerificationEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { enforceRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { issueToken, markTokenSent } from "@/lib/tokens";

export const runtime = "nodejs";

/**
 * BL-STAB-8b-1 — the verification email again, for an account that never
 * verified. Unauthenticated and it sends mail: 3 per address and 10 per
 * IP in an hour, failing closed; the answer is neutral whether or not
 * the address has such an account; a verified or disabled account gets
 * nothing. Each issue replaces the previous link.
 */
export async function POST(req: Request) {
  let payload: { email?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const byIp = await enforceRateLimit({ key: `resend-verification:ip:${ipFromRequest(req)}`, limit: 10, windowSeconds: 3600, failClosed: true });
  const byEmail = byIp.ok ? await enforceRateLimit({ key: `resend-verification:email:${email}`, limit: 3, windowSeconds: 3600, failClosed: true }) : byIp;
  const denied = !byIp.ok ? byIp : !byEmail.ok ? byEmail : null;
  if (denied) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(denied.retryAfter) } },
    );
  }

  const [user] = await db
    .select({ id: users.id, emailVerified: users.emailVerified, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (user && !user.emailVerified && !user.disabledAt) {
    const token = await issueToken("verify-email", email);
    if (!emailConfigured()) {
      log.error("[resend-verification]", "requested but email is not configured: nothing sent", { userId: user.id });
    } else {
      try {
        await sendVerificationEmail(email, token);
        await markTokenSent("verify-email", email);
      } catch (err) {
        log.error("[resend-verification]", "sendVerificationEmail failed", { error: err, userId: user.id });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
