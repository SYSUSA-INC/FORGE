import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, validatePasswordStrength } from "@/lib/passwords";
import { sendVerificationEmail } from "@/lib/email";
import { issueToken } from "@/lib/tokens";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let payload: { email?: unknown; password?: unknown; name?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const pwError = validatePasswordStrength(password);
  if (pwError) {
    return NextResponse.json({ ok: false, error: pwError }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing?.emailVerified) {
    return NextResponse.json(
      { ok: false, error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  if (existing && !existing.emailVerified) {
    await db
      .update(users)
      .set({ passwordHash, name: name || null, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      email,
      name: name || null,
      passwordHash,
    });
  }

  const token = await issueToken("verify-email", email);

  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error("[register] sendVerificationEmail failed", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Account created, but we couldn't send the verification email. Try signing in or contact support.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
