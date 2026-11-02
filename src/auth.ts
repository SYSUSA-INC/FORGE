import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, allowlist, memberships, organizations, users, type Role } from "@/db/schema";
import { authConfig } from "@/auth.config";
import { verifyPassword } from "@/lib/passwords";
import { defaultOrgName, defaultOrgSlug } from "@/lib/org-defaults";
import { selfServiceRegistrationAllowed } from "@/lib/signup-mode";
import { attachPendingInvitesByEmail } from "@/lib/invite-accept";
import { findHomeOrganizationForEmail } from "@/lib/invite-approval";
import { domainOf, isPublicEmailDomain } from "@/lib/email-domain";
import { log } from "@/lib/log";
import { decideOAuthSignIn, ENTRA_PROVIDER, entraAllowedTenants, oauthErrorParam } from "@/lib/oauth-policy";
import { superadminNeedsPasskey } from "@/lib/passkeys";
import { getPlatformSetting } from "@/lib/platform-settings";
import { evaluateSession, mfaEnforcementNow, needsRecheck, SESSION_POLICY, touchSession } from "@/lib/session-policy";
import { recordAudit } from "@/lib/audit-log";
import { enforceRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { ensureTenantSubscription } from "@/lib/tenant-subscription";

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

async function provisionOrgForUser(
  userId: string,
  name: string | null | undefined,
  email: string | null | undefined,
) {
  const [existing] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (existing) return;

  // BL-AUTH-DOMAIN — by default a person may only join the tenant that
  // owns their email domain. When one does, no shadow workspace is
  // founded for them: they need an invitation from that tenant's admin
  // (which the sign-in event above will pick up once it exists).
  const home = email ? await findHomeOrganizationForEmail(email) : null;
  if (home) {
    log.warn("[provisionOrgForUser]", "skipped: email domain belongs to an existing tenant", {
      userId,
      organizationId: home.id,
    });
    return;
  }
  const ownDomain = domainOf(email);

  const [org] = await db
    .insert(organizations)
    .values({
      name: defaultOrgName(name ?? ""),
      slug: defaultOrgSlug(name ?? ""),
      emailDomains: ownDomain && !isPublicEmailDomain(ownDomain) ? [ownDomain] : [],
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
    // BL-TIER-ASSIGN — default tier on creation (best-effort).
    await ensureTenantSubscription({ organizationId: org.id });
  } catch (err) {
    log.error("[provisionOrgForUser]", "membership insert failed", { error: err });
    await db
      .delete(organizations)
      .where(eq(organizations.id, org.id))
      .catch(() => undefined);
  }
}

const SIGN_IN_WINDOW_SECONDS = 15 * 60;
const SIGN_IN_PER_EMAIL = 10;
const SIGN_IN_PER_IP = 60;

async function signInAllowed(email: string, request: Request): Promise<boolean> {
  const byEmail = await enforceRateLimit({
    key: `signin:email:${email}`,
    limit: SIGN_IN_PER_EMAIL,
    windowSeconds: SIGN_IN_WINDOW_SECONDS,
    failClosed: true,
  });
  const byIp = await enforceRateLimit({
    key: `signin:ip:${ipFromRequest(request)}`,
    limit: SIGN_IN_PER_IP,
    windowSeconds: SIGN_IN_WINDOW_SECONDS,
    failClosed: true,
  });
  if (byEmail.ok && byIp.ok) return true;
  log.warn("[auth]", "sign-in rate limited", { reason: byEmail.ok ? "ip" : "email" });
  return false;
}

/** BL-STAB-8a-2 — the platform-wide epoch: raising it ends every session (the release step). */
export async function currentSessionEpoch(): Promise<number> {
  const raw = await getPlatformSetting("auth.session_epoch", "0");
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** BL-STAB-8b-1 — the credentials sign-in's one revealing refusal: right password, address not yet verified. */
class UnverifiedEmail extends CredentialsSignin {
  code = "unverified_email";
}

export const { auth, handlers, signIn, signOut, unstable_update } = NextAuth({
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
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email).toLowerCase().trim();
        const password = String(credentials.password);
        if (!email || !password) return null;

        // BL-STAB-8a-0 — brute-force limits that fail closed: a broken
        // counter store must not turn into unlimited password guesses.
        // The same refusal as a wrong password, so it reveals nothing.
        if (!(await signInAllowed(email, request))) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!user) return null;
        if (!user.passwordHash) return null;
        if (user.disabledAt) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        // BL-STAB-8b-1 — the right password on an unverified address: say
        // so (the password already proves who is asking) and offer the
        // verification email again; a wrong password stays "invalid".
        if (!user.emailVerified) throw new UnverifiedEmail();

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // BL-STAB-8a-0 — the adapter may link a provider account to an existing
    // user by email only after `callbacks.signIn` has approved it, and that
    // policy (src/lib/oauth-policy.ts) approves a link by email only through
    // a pending invite. So the flag stays on for the link itself, and the
    // callback is what makes it safe.
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
      // BL-STAB-8b-1 — a Google / Microsoft sign-in reaches here only with a
      // provider-verified address (callbacks.signIn): FORGE's stamp too.
      await db.update(users).set({ emailVerified: sql`COALESCE(${users.emailVerified}, now())` }).where(eq(users.id, user.id));

      // BL-AUTH-INVITE — an invitee who signs in with Google / Microsoft
      // instead of the emailed link: the provider proved the address, the
      // allow-list row is the authorisation. Attach the membership and
      // keep the account; the invite_only guard below is for strangers.
      try {
        const attached = await attachPendingInvitesByEmail({
          userId: user.id,
          email: user.email,
        });
        if (attached.attached > 0 || attached.alreadyMember > 0) {
          log.info("[events.createUser]", "accepted pending invite via OAuth", {
            userId: user.id,
            organizations: attached.organizationIds.length,
          });
          return;
        }
      } catch (err) {
        log.error("[events.createUser]", "invite attach failed", { error: err });
      }

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
        await provisionOrgForUser(user.id, user.name, user.email);
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
      // BL-AUTH-INVITE — an existing account (password or OAuth) that was
      // later invited to a tenant picks the membership up on its next
      // sign-in, without needing the emailed link.
      try {
        await attachPendingInvitesByEmail({ userId: user.id, email: user.email });
      } catch (err) {
        log.error("[events.signIn]", "invite attach failed", { error: err });
      }
      if (!selfServiceRegistrationAllowed()) return;
      try {
        await provisionOrgForUser(user.id, user.name, user.email);
      } catch (err) {
        log.error("[events.signIn]", "org provisioning failed", { error: err });
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      // BL-STAB-8a-0 — Google / Microsoft: the policy in oauth-policy.ts.
      // It runs before the adapter links or creates anything, so a
      // stranger in invite-only mode is never created (and never deleted),
      // a disabled person is refused on a first link too, an address alone
      // links nothing without an invite, and Microsoft sign-ins must come
      // from an allow-listed tenant.
      if (account && account.provider !== "credentials") {
        const email = (user?.email ?? (profile as { email?: string } | undefined)?.email ?? "").trim().toLowerCase() || null;
        const p = (profile ?? {}) as { email_verified?: boolean; tid?: string };
        const [linked, byEmail, invite] = await Promise.all([
          db
            .select({ id: users.id, disabledAt: users.disabledAt })
            .from(accounts)
            .innerJoin(users, eq(users.id, accounts.userId))
            .where(and(eq(accounts.provider, account.provider), eq(accounts.providerAccountId, account.providerAccountId)))
            .limit(1),
          email ? db.select({ id: users.id, disabledAt: users.disabledAt }).from(users).where(eq(users.email, email)).limit(1) : Promise.resolve([]),
          email
            ? db
                .select({ id: allowlist.id })
                .from(allowlist)
                .where(and(eq(allowlist.email, email), eq(allowlist.revoked, false), isNull(allowlist.consumedAt), sql`(${allowlist.crossDomain} = false OR ${allowlist.platformApprovedAt} IS NOT NULL)`))
                .limit(1)
            : Promise.resolve([]),
        ]);
        const decision = decideOAuthSignIn({
          provider: account.provider,
          email,
          // Entra's token is for a verified directory account; Google says so explicitly.
          emailVerifiedByProvider: account.provider === ENTRA_PROVIDER ? true : p.email_verified === true,
          linkedUser: linked[0] ?? null,
          userByEmail: byEmail[0] ?? null,
          pendingInvite: invite.length > 0,
          signupOpen: selfServiceRegistrationAllowed(),
          entraTenant: account.provider === ENTRA_PROVIDER ? (p.tid ?? null) : null,
          allowedTenants: account.provider === ENTRA_PROVIDER ? entraAllowedTenants({ AUTH_MICROSOFT_ENTRA_ID_TENANTS: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANTS, AUTH_MICROSOFT_ENTRA_ID_ISSUER: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER }) : [],
        });
        if (!decision.ok) {
          log.warn("[auth]", "oauth sign-in refused", { provider: account.provider, code: decision.code, identity: email ?? account.providerAccountId });
          return `/sign-in?error=${oauthErrorParam(decision.code)}`;
        }
        // BL-STAB-8b-1 — the policy let only a provider-verified address
        // through: FORGE's own stamp follows for the account it opens.
        const opened = linked[0] ?? byEmail[0];
        if (opened) {
          await db.update(users).set({ emailVerified: sql`COALESCE(${users.emailVerified}, now())` }).where(eq(users.id, opened.id));
        }
        return true;
      }
      // Password sign-in: `authorize` already refused a disabled person; this
      // keeps the check for any other provider that may be added.
      if (!user?.id) return true;
      const [row] = await db
        .select({ disabledAt: users.disabledAt })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (row?.disabledAt) return false;
      return true;
    },
    async jwt({ token, user, trigger }) {
      const now = Date.now();
      if (user?.id) {
        // BL-STAB-8a-2 — sign-in: the claims the policy reads. The second
        // step is owed unless enforcement is off; a person with no factor
        // enrols first. The pending id keys the server-side pass marker.
        token.id = user.id;
        const [row] = await db
          .select({ mfaEnrolledAt: users.mfaEnrolledAt, sessionVersion: users.sessionVersion, isSuperadmin: users.isSuperadmin, emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        // BL-STAB-8b-1 — no session for an unverified address, whoever
        // created the account and whatever provider signed it in.
        if (!row?.emailVerified) {
          log.warn("[auth]", "sign-in refused: email not verified", { userId: user.id });
          return null;
        }
        const enforcement = mfaEnforcementNow();
        token.iatMs = now;
        token.lastActive = now;
        token.chk = now;
        token.sv = row?.sessionVersion ?? 1;
        token.epoch = await currentSessionEpoch();
        token.pid = crypto.randomUUID();
        if (enforcement.on) {
          // BL-STAB-8a-3 — a platform superadmin must hold a passkey: with
          // none, the first sign-in enrols one before anything opens.
          const needsPasskey = !!row?.isSuperadmin && (await superadminNeedsPasskey(user.id));
          token.mfa = row?.mfaEnrolledAt && !needsPasskey ? "pending" : "enrol";
          token.pendingAt = now;
          token.amr = undefined;
        } else {
          token.mfa = "ok";
          token.amr = "bypass";
          token.pendingAt = undefined;
          log.warn("[auth]", "second step skipped: MFA enforcement is off", { userId: user.id, reason: enforcement.reason });
        }
      }
      if (!token.id) return token;

      if (evaluateSession(token, now) !== "ok") return null;
      token = touchSession(token, now);

      // The second step passed: the verify or enrol action wrote the pass
      // marker for this pending id, then asked for a session update. The
      // client can trigger an update too, but cannot write the marker.
      if (trigger === "update" && token.mfa !== "ok" && token.pid) {
        const [u] = await db
          .select({ pid: users.mfaPassPid, at: users.mfaPassAt })
          .from(users)
          .where(eq(users.id, token.id as string))
          .limit(1);
        if (u?.pid === token.pid && u.at && now - u.at.getTime() <= SESSION_POLICY.pendingMs) {
          token.mfa = "ok";
          token.amr = token.amr ?? "code";
          token.pendingAt = undefined;
          await db.update(users).set({ mfaPassPid: null, mfaPassAt: null }).where(eq(users.id, token.id as string));
        }
      }

      // Once a minute: the person still exists and is not disabled, their
      // session version is the one this token was issued under, and the
      // platform epoch has not moved. Any change ends the session.
      if (needsRecheck(token, now)) {
        const [u] = await db
          .select({ sessionVersion: users.sessionVersion, disabledAt: users.disabledAt })
          .from(users)
          .where(eq(users.id, token.id as string))
          .limit(1);
        const epoch = await currentSessionEpoch();
        if (!u || u.disabledAt || u.sessionVersion !== token.sv || epoch !== token.epoch) return null;
        token.chk = now;
      }

      const enriched = await enrichFromDb(token.id as string);
      token.isSuperadmin = enriched.isSuperadmin;
      token.organizationId = enriched.organizationId;
      token.role = enriched.role;
      if (user?.id && token.amr === "bypass" && enriched.organizationId) {
        await recordAudit({
          organizationId: enriched.organizationId,
          actor: { userId: user.id, email: user.email },
          action: "auth.mfa.bypassed",
          resourceType: "user",
          resourceId: user.id,
          metadata: { reason: (() => { const e = mfaEnforcementNow(); return e.on ? null : e.reason; })() },
        });
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.isSuperadmin = token.isSuperadmin ?? false;
        session.user.organizationId = token.organizationId ?? null;
        session.user.role = token.role ?? null;
        session.user.mfa = token.mfa ?? "pending";
        session.user.pid = token.mfa === "ok" ? null : (token.pid ?? null);
      }
      return session;
    },
  },
});
