import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";
import { issueToken } from "@/lib/tokens";

export const runtime = "nodejs";

export async function POST(req: Request) {
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
      console.error("[forgot-password] sendPasswordResetEmail failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}
