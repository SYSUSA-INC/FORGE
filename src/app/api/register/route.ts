import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, memberships, organizations, users } from "@/db/schema";
import { hashPassword, validatePasswordStrength } from "@/lib/passwords";
import { sendVerificationEmail } from "@/lib/email";
import { consumeToken, issueToken } from "@/lib/tokens";
import { defaultOrgName, defaultOrgSlug } from "@/lib/org-defaults";
import { enforceRateLimit, ipFromRequest } from "@/lib/rate-limit";
import {
  anySignupAllowed,
  selfServiceRegistrationAllowed,
} from "@/lib/signup-mode";
import { log } from "@/lib/log";

export const runtime = "nodejs";

async function provisionUserAndOrg(opts: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<{ userId: string; organizationId: string }> {
  const [user] = await db
    .insert(users)
    .values({
      email: opts.email,
      name: opts.name || null,
      passwordHash: opts.passwordHash,
    })
    .returning({ id: users.id });
  if (!user) throw new Error("User insert returned empty");

  try {
    const [org] = await db
      .insert(organizations)
      .values({
        name: defaultOrgName(opts.name),
        slug: defaultOrgSlug(opts.name),
      })
      .returning({ id: organizations.id });
    if (!org) throw new Error("Organization insert returned empty");

    try {
      await db.insert(memberships).values({
        userId: user.id,
        organizationId: org.id,
        role: "admin",
        status: "active",
      });
      return { userId: user.id, organizationId: org.id };
    } catch (err) {
      await db
        .delete(organizations)
        .where(eq(organizations.id, org.id))
        .catch(() => undefined);
      throw err;
    }
  } catch (err) {
    await db.delete(users).where(eq(users.id, user.id)).catch(() => undefined);
    throw err;
  }
}

async function acceptInvite(opts: {
  inviteId: string;
  rawToken: string;
  name: string;
  passwordHash: string;
}): Promise<
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; error: string; status?: number }
> {
  const [inv] = await db
    .select()
    .from(allowlist)
    .where(
      and(eq(allowlist.id, opts.inviteId), eq(allowlist.revoked, false)),
    )
    .limit(1);

  if (!inv) return { ok: false, error: "Invitation not found or revoked.", status: 404 };
  if (inv.consumedAt) {
    return { ok: false, error: "Invitation already used.", status: 409 };
  }

  const ok = await consumeToken("invite", inv.id, opts.rawToken);
  if (!ok) {
    return { ok: false, error: "Invitation link is invalid or expired.", status: 400 };
  }

  const email = inv.email.toLowerCase();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  if (existing) {
    await db
      .update(users)
      .set({
        passwordHash: opts.passwordHash,
        name: opts.name || null,
        emailVerified: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: opts.name || null,
        passwordHash: opts.passwordHash,
        emailVerified: new Date(),
      })
      .returning({ id: users.id });
    if (!created) {
      return { ok: false, error: "Could not create user.", status: 500 };
    }
    userId = created.id;
  }

  const [existingMembership] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, inv.organizationId),
      ),
    )
    .limit(1);

  // Membership insert MUST succeed before we mark the invite consumed.
  // Otherwise a transient DB error would burn the invite token without
  // creating the membership — the user couldn't retry (token gone) and
  // couldn't sign in (no membership). On failure we surface the error
  // and leave the allowlist row consumable.
  if (!existingMembership) {
    try {
      await db.insert(memberships).values({
        userId,
        organizationId: inv.organizationId,
        role: inv.role,
        status: "active",
        title: inv.title,
      });
    } catch (err) {
      log.error("[acceptInvite]", "membership insert failed", { error: err });
      return {
        ok: false,
        error:
          "Could not finish creating your account — please try again or contact support.",
        status: 500,
      };
    }
  }

  // Only now is it safe to mark the invite consumed.
  await db
    .update(allowlist)
    .set({ consumedAt: new Date() })
    .where(eq(allowlist.id, inv.id));

  return { ok: true, userId, organizationId: inv.organizationId };
}

export async function POST(req: Request) {
  try {
    if (!anySignupAllowed()) {
      return NextResponse.json(
        { ok: false, error: "Sign-up is currently disabled." },
        { status: 403 },
      );
    }

    // Rate limit per source IP. Belt-and-suspenders against bot signup
    // bursts even when SIGNUP_MODE=invite_only — the invite path still
    // counts toward this bucket so attackers can't enumerate live
    // invite ids by spamming the endpoint.
    const ip = ipFromRequest(req);
    const limit = await enforceRateLimit({
      key: `register:ip:${ip}`,
      limit: 5,
      windowSeconds: 3600,
    });
    if (!limit.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Too many sign-up attempts from this network. Try again in an hour.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfter) },
        },
      );
    }

    let payload: {
      email?: unknown;
      password?: unknown;
      name?: unknown;
      inviteId?: unknown;
      inviteToken?: unknown;
    };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid request." },
        { status: 400 },
      );
    }

    const password = typeof payload.password === "string" ? payload.password : "";
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const inviteId =
      typeof payload.inviteId === "string" ? payload.inviteId.trim() : "";
    const inviteToken =
      typeof payload.inviteToken === "string" ? payload.inviteToken.trim() : "";

    const pwError = validatePasswordStrength(password);
    if (pwError) {
      return NextResponse.json({ ok: false, error: pwError }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);

    // Invite path — email is taken from allowlist, email is pre-verified.
    // Always allowed (when sign-up isn't fully disabled), regardless of
    // SIGNUP_MODE — the allowlist + token IS the authorization.
    if (inviteId && inviteToken) {
      const res = await acceptInvite({
        inviteId,
        rawToken: inviteToken,
        name,
        passwordHash,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: res.error },
          { status: res.status ?? 400 },
        );
      }
      return NextResponse.json({ ok: true, verified: true });
    }

    // Self-service signup path. Gated behind SIGNUP_MODE=open. Default
    // (invite_only) rejects with 403 — bots and unsolicited public signup
    // can't auto-provision orgs.
    if (!selfServiceRegistrationAllowed()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Public sign-up is disabled. Ask your organization admin for an invitation, or contact support@sysgov.com.",
        },
        { status: 403 },
      );
    }

    // Self-service signup path — auto-creates org, requires email verification.
    const email =
      typeof payload.email === "string"
        ? payload.email.trim().toLowerCase()
        : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid email address." },
        { status: 400 },
      );
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

    if (existing && !existing.emailVerified) {
      await db
        .update(users)
        .set({ passwordHash, name: name || null, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
    } else {
      try {
        await provisionUserAndOrg({ email, name, passwordHash });
      } catch (err) {
        log.error("[register]", "provisionUserAndOrg failed", { error: err });
        return NextResponse.json(
          {
            ok: false,
            error:
              "Could not create account. Please try again or contact support.",
          },
          { status: 500 },
        );
      }
    }

    const token = await issueToken("verify-email", email);

    try {
      await sendVerificationEmail(email, token);
    } catch (err) {
      log.error("[register]", "sendVerificationEmail failed", { error: err });
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
  } catch (err) {
    log.error("[register]", "unhandled error", { error: err });
    return NextResponse.json(
      { ok: false, error: "Unexpected server error. Please try again." },
      { status: 500 },
    );
  }
}
