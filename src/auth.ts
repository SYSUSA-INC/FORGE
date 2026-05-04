import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, users, type Role } from "@/db/schema";
import { authConfig } from "@/auth.config";
import { verifyPassword } from "@/lib/passwords";
import { defaultOrgName, defaultOrgSlug } from "@/lib/org-defaults";
import { selfServiceRegistrationAllowed } from "@/lib/signup-mode";
import { log } from "@/lib/log";

async function enrichFromDb(userId: string): Promise<{
  isSuperadmin: boolean;
  organizationId: string | null;
  role: Role | null;
  disabled: boolean;
}> {
  const [user] = await db
    .select({
      isSuperadmin: users.isSuperadmin,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [membership] = await db
    .select({
      organizationId: memberships.organizationId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        isNull(organizations.disabledAt),
      ),
    )
    .limit(1);

  return {
    isSuperadmin: user?.isSuperadmin ?? false,
    organizationId: membership?.organizationId ?? null,
    role: membership?.role ?? null,
    disabled: !!user?.disabledAt,
  };
}

async function provisionOrgForUser(userId: string, name: string | null | undefined) {
  const [existing] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (existing) return;

  const [org] = await db
    .insert(organizations)
    .values({
      name: defaultOrgName(name ?? ""),
      slug: defaultOrgSlug(name ?? ""),
    })
    .returning({ id: organizations.id });
  if (!org) return;

  try {
    await db.insert(memberships).values({
      userId,
      organizationId: org.id,
      role: "admin",
      status: "active",
    });
  } catch (err) {
    log.error("[provisionOrgForUser]", "membership insert failed", { error: err });
    await db
      .delete(organizations)
      .where(eq(organizations.id, org.id))
      .catch(() => undefined);
  }
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  ...authConfig,
  providers: [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email).toLowerCase().trim();
        const password = String(credentials.password);
        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!user) return null;
        if (!user.passwordHash) return null;
        if (!user.emailVerified) return null;
        if (user.disabledAt) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  events: {
    async createUser({ user }) {
      if (!user.id) return;

      // Security gate: the OAuth providers' "auto-create on first sign-in"
      // is itself a public signup vector. Without this check, anyone with a
      // Google/Microsoft account can hit /sign-in and silently get an org
      // provisioned. SIGNUP_MODE=invite_only blocks that — we delete the
      // user immediately so the next sign-in attempt doesn't see a half-
      // created account.
      if (!selfServiceRegistrationAllowed()) {
        try {
          await db.delete(users).where(eq(users.id, user.id));
        } catch (err) {
          log.error("[events.createUser]", "failed to delete unauthorized user", {
            error: err,
          });
        }
        log.warn("[events.createUser]", "blocked OAuth signup (SIGNUP_MODE != open)", {
          identity: user.email ?? user.id,
        });
        return;
      }

      try {
        await provisionOrgForUser(user.id, user.name);
      } catch (err) {
        log.error("[events.createUser]", "org provisioning failed", { error: err });
      }
    },
    async signIn({ user }) {
      // Belt-and-suspenders: for OAuth sign-ins that didn't trigger
      // createUser (e.g., account linking into an existing user with no
      // org), ensure a workspace exists. Same gate — only when
      // SIGNUP_MODE=open. Existing users with existing orgs aren't
      // affected because provisionOrgForUser is a no-op when they already
      // have a membership.
      if (!user?.id) return;
      if (!selfServiceRegistrationAllowed()) return;
      try {
        await provisionOrgForUser(user.id, user.name);
      } catch (err) {
        log.error("[events.signIn]", "org provisioning failed", { error: err });
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      // Block sign-in for disabled users, including OAuth flows.
      if (!user?.id) return true;
      const [row] = await db
        .select({ disabledAt: users.disabledAt })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (row?.disabledAt) return false;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      if (token.id) {
        const enriched = await enrichFromDb(token.id as string);
        token.isSuperadmin = enriched.isSuperadmin;
        token.organizationId = enriched.organizationId;
        token.role = enriched.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.isSuperadmin = token.isSuperadmin ?? false;
        session.user.organizationId = token.organizationId ?? null;
        session.user.role = token.role ?? null;
      }
      return session;
    },
  },
});
