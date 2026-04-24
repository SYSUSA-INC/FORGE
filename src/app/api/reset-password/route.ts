import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, validatePasswordStrength } from "@/lib/passwords";
import { consumeToken } from "@/lib/tokens";

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

  const ok = await consumeToken("reset-password", email, rawToken);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Reset link is invalid or has expired." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);

  const result = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.email, email));

  if (!result) {
    return NextResponse.json(
      { ok: false, error: "Account not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
