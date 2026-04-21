import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, users } from "@/db/schema";
import { hashPassword, validatePasswordStrength } from "@/lib/passwords";
import { sendVerificationEmail } from "@/lib/email";
import { issueToken } from "@/lib/tokens";
import { defaultOrgName, defaultOrgSlug } from "@/lib/org-defaults";

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

export async function POST(req: Request) {
  try {
    let payload: { email?: unknown; password?: unknown; name?: unknown };
    try {
      payload = (await req.json()) as typeof payload;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid request." },
        { status: 400 },
      );
    }

    const email =
      typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
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
      try {
        await provisionUserAndOrg({ email, name, passwordHash });
      } catch (err) {
        console.error("[register] provisionUserAndOrg failed", err);
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
  } catch (err) {
    console.error("[register] unhandled error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected server error. Please try again." },
      { status: 500 },
    );
  }
}
