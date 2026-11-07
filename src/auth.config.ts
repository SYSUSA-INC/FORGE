import type { NextAuthConfig } from "next-auth";
import { evaluateSession, gateRedirect, SESSION_POLICY, touchSession } from "@/lib/session-policy";

export const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  // BL-STAB-8a-2 — 24 hours at most; the idle limit and the absolute limit
  // are enforced on the claims (session-policy.ts), the cookie just follows.
  session: { strategy: "jwt", maxAge: SESSION_POLICY.absoluteMs / 1000 },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      // BL-STAB-8a-2 — a session that has not passed the second step goes
      // to the verify (or enrol) page and nowhere else.
      if (auth?.user) {
        const to = gateRedirect(pathname, auth.user.mfa);
        if (to) {
          const url = new URL(to, request.nextUrl);
          if (!pathname.startsWith("/sign-in")) url.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
          return Response.redirect(url);
        }
      }

      if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return true;
      if (pathname === "/sign-up" || pathname.startsWith("/sign-up/")) return true;
      if (pathname === "/verify-email" || pathname.startsWith("/verify-email/"))
        return true;
      if (pathname === "/forgot-password") return true;
      if (pathname === "/reset-password" || pathname.startsWith("/reset-password/"))
        return true;
      if (pathname.startsWith("/api/auth")) return true;
      if (pathname.startsWith("/api/register")) return true;
      // BL-AUTH-ABUSE Slice 2b — the public Request-a-trial page and endpoint.
      if (pathname === "/request-trial") return true;
      if (pathname === "/api/trial-request") return true;
      if (pathname.startsWith("/api/forgot-password")) return true;
      if (pathname.startsWith("/api/reset-password")) return true;
      if (pathname.startsWith("/api/samgov/health")) return true;
      // Client-side error boundary posts to /api/error-report when
      // the global error catches anything. Errors fired before auth
      // resolves (sign-in page crashes etc.) must still get logged.
      if (pathname.startsWith("/api/error-report")) return true;
      // Vercel Cron handlers self-authenticate via
      // `Authorization: Bearer ${CRON_SECRET}` and return 401 without
      // it. Letting the middleware bounce them to /sign-in (307) breaks
      // every scheduled job — SLA escalation, audit-log prune, batched
      // notifications, monthly cert refresh.
      if (pathname.startsWith("/api/cron/")) return true;
      // Token-authed public review page — opportunity review requests
      // can be answered by reviewers who don't have a FORGE account.
      if (pathname.startsWith("/review/")) return true;
      // BL-NAV-LIFECYCLE 3c — a partner's personal link to the matrix
      // questions; no FORGE account, the token is the credential.
      if (pathname.startsWith("/partner/")) return true;
      // Public pricing page — anyone can see what we sell before
      // creating an account.
      if (pathname === "/pricing") return true;
      // Stripe webhook — authenticated by the stripe-signature header,
      // verified inside the route handler against STRIPE_WEBHOOK_SECRET.
      // The middleware can't run that check, so let the request through
      // unconditionally and the route enforces signing.
      if (pathname === "/api/webhooks/stripe") return true;
      // BL-16 apiAccess — the public read-only API authenticates each
      // request with a workspace API token (Authorization: Bearer forge_…)
      // inside the route handler; there is no session to check here.
      if (pathname.startsWith("/api/v1/")) return true;

      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      // BL-STAB-8a-2 — the edge sees every request: a session past its idle
      // or absolute limit, a pending step past ten minutes, or a token from
      // before this policy (no claims) ends here. Otherwise note the activity.
      if (token.id) {
        if (evaluateSession(token, Date.now()) !== "ok") return null;
        return touchSession(token, Date.now());
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session.user) {
        session.user.id = token.id as string;
        session.user.mfa = token.mfa ?? "pending";
        session.user.pid = token.mfa === "ok" ? null : (token.pid ?? null);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
