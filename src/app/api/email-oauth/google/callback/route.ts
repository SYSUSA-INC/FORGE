import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import {
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  upsertEmailOauthAccount,
} from "@/lib/email-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsRedirect(query: string): NextResponse {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://www.sysgov.com");
  return NextResponse.redirect(new URL(`/settings/email?${query}`, base));
}

export async function GET(req: NextRequest) {
  const user = await requireAuth();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return settingsRedirect(`error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !returnedState) {
    return settingsRedirect("error=Missing+code+or+state.");
  }

  // Verify state cookie set in /connect.
  const cookieState = req.cookies.get("email_oauth_state")?.value ?? "";
  if (!cookieState || cookieState !== returnedState) {
    return settingsRedirect("error=State+mismatch.+Restart+the+connection.");
  }
  const [stateUserId] = returnedState.split(":");
  if (stateUserId !== user.id) {
    return settingsRedirect("error=State+user+mismatch.");
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    const accessToken = tokens.access_token;
    if (!accessToken) {
      return settingsRedirect("error=No+access+token+returned+by+Google.");
    }
    const profile = await fetchGoogleUserInfo(accessToken);
    if (!profile.email) {
      return settingsRedirect("error=Google+account+has+no+email.");
    }

    await upsertEmailOauthAccount({
      userId: user.id,
      provider: "google",
      emailAddress: profile.email,
      accessToken,
      refreshToken: tokens.refresh_token ?? "",
      scope: tokens.scope ?? "",
      expiresIn: tokens.expires_in,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Connect failed.";
    return settingsRedirect(`error=${encodeURIComponent(msg)}`);
  }

  const res = settingsRedirect("connected=1");
  res.cookies.set("email_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
