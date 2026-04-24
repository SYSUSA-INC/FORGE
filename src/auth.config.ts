import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return true;
      if (pathname === "/sign-up" || pathname.startsWith("/sign-up/")) return true;
      if (pathname === "/verify-email" || pathname.startsWith("/verify-email/"))
        return true;
      if (pathname === "/forgot-password") return true;
      if (pathname === "/reset-password" || pathname.startsWith("/reset-password/"))
        return true;
      if (pathname.startsWith("/api/auth")) return true;
      if (pathname.startsWith("/api/register")) return true;
      if (pathname.startsWith("/api/forgot-password")) return true;
      if (pathname.startsWith("/api/reset-password")) return true;
      if (pathname.startsWith("/api/samgov/health")) return true;

      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
