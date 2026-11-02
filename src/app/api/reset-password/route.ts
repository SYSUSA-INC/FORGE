import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, validatePasswordStrength } from "@/lib/passwords";
import { emailConfigured, sendVerificationEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { consumeTokenDetailed, issueToken, markTokenSent } from "@/lib/tokens";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let payload: { token?: unknown; email?: unknown; password?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const rawToken = typeof payload.token === "string" ? payload.token : "";
  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!rawToken || !email) {
    return NextResponse.json(
      { ok: false, error: "Reset link is invalid." },
      { status: 400 },
    );
  }

  const pwError = validatePasswordStrength(password);
  if (pwError) {
    return NextResponse.json({ ok: false, error: pwError }, { status: 400 });
  }

  const spent = await consumeTokenDetailed("reset-password", email, rawToken);
  if (!spent.ok) {
    return NextResponse.json(
      { ok: false, error: "Reset link is invalid or has expired." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);

  // BL-AUTH-INVITE — following the emailed link proves the address, so
  // an account that never finished verification becomes sign-in-able
  // here (the credentials provider requires emailVerified).
  // BL-STAB-8b-1 — only when the link went through the inbox: a copied
  // reset link sets the password and nothing else, and the verification
  // email follows for an address still unverified.
  const updated = await db
    .update(users)
    .set({
      passwordHash,
      ...(spent.sentByEmail ? { emailVerified: sql`COALESCE(${users.emailVerified}, now())` } : {}),
      // BL-STAB-8a-2 — a new password ends every open session.
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.email, email))
    .returning({ id: users.id, emailVerified: users.emailVerified });

  if (updated.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Account not found." },
      { status: 404 },
    );
  }

  const verified = !!updated[0]!.emailVerified;
  if (!verified && emailConfigured()) {
    try {
      const token = await issueToken("verify-email", email);
      await sendVerificationEmail(email, token);
      await markTokenSent("verify-email", email);
    } catch (err) {
      log.error("[reset-password]", "verification email after a copied reset link failed", { error: err });
    }
  }

  return NextResponse.json({ ok: true, verified });
}
