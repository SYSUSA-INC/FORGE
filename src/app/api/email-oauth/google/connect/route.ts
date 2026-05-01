import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { buildGoogleAuthUrl } from "@/lib/email-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireAuth();

  // The state cookie ties the callback back to this user and protects
  // against CSRF. We sign it with a random nonce that we re-check on
  // callback. 10-minute TTL is plenty for an OAuth round trip.
  const nonce = crypto.randomBytes(24).toString("hex");
  const state = `${user.id}:${nonce}`;

  let authUrl: string;
  try {
    authUrl = buildGoogleAuthUrl(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth not configured.";
    return NextResponse.redirect(
      new URL(`/settings/email?error=${encodeURIComponent(msg)}`, process.env.NEXT_PUBLIC_APP_URL ?? "https://www.sysgov.com"),
    );
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("email_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
