import { redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { allowlist, organizations } from "@/db/schema";
import { SsoButtons } from "@/components/auth/SsoButtons";
import { SignUpForm } from "./SignUpForm";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: { sent?: string; invite?: string; id?: string };
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const pending = searchParams.sent === "1";
  const inviteToken = searchParams.invite;
  const inviteId = searchParams.id;

  let invite: {
    id: string;
    email: string;
    role: string;
    organizationName: string;
    expired?: boolean;
    consumed?: boolean;
  } | null = null;

  if (inviteToken && inviteId) {
    const [row] = await db
      .select({
        id: allowlist.id,
        email: allowlist.email,
        role: allowlist.role,
        consumedAt: allowlist.consumedAt,
        revoked: allowlist.revoked,
        orgName: organizations.name,
      })
      .from(allowlist)
      .innerJoin(organizations, eq(organizations.id, allowlist.organizationId))
      .where(eq(allowlist.id, inviteId))
      .limit(1);

    if (row && !row.revoked) {
      invite = {
        id: row.id,
        email: row.email,
        role: row.role,
        organizationName: row.orgName,
        consumed: !!row.consumedAt,
      };
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-12">
      <div className="aur-card-elevated w-full max-w-md overflow-hidden">
        <div
          className="h-[2px] w-full"
          style={{
            background: "linear-gradient(90deg, #2DD4BF, #34D399 55%, #EC4899)",
          }}
        />
        <div className="px-8 py-10">
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow"
              style={{
                background:
                  "linear-gradient(135deg, #2DD4BF, #34D399 55%, #EC4899 100%)",
              }}
            >
              F
            </div>
            <div>
              <div className="font-display text-[15px] font-semibold tracking-tight text-text">
                FORGE
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
                Proposal Ops
              </div>
            </div>
          </div>

          {pending ? (
            <>
              <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight text-text">
                Check your inbox
              </h1>
              <p className="mt-2 text-sm text-muted">
                We sent a verification link. Click it to confirm your email, then sign in.
                The link expires in 24 hours.
              </p>
              <Link
                href="/sign-in"
                className="aur-btn aur-btn-ghost mt-6 flex w-full items-center justify-center py-3 text-sm"
              >
                Go to sign in
              </Link>
            </>
          ) : inviteToken && inviteId && !invite ? (
            <>
              <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight text-text">
                Invitation not found
              </h1>
              <p className="mt-2 text-sm text-muted">
                This invite link is invalid or has been revoked. Ask your admin to resend it.
              </p>
              <Link
                href="/sign-in"
                className="aur-btn aur-btn-ghost mt-6 flex w-full items-center justify-center py-3 text-sm"
              >
                Go to sign in
              </Link>
            </>
          ) : invite?.consumed ? (
            <>
              <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight text-text">
                Invitation already used
              </h1>
              <p className="mt-2 text-sm text-muted">
                Sign in to access <strong>{invite.organizationName}</strong>.
              </p>
              <Link
                href="/sign-in"
                className="aur-btn aur-btn-primary mt-6 flex w-full items-center justify-center py-3 text-sm"
              >
                Sign in
              </Link>
            </>
          ) : invite ? (
            <>
              <div className="mt-8 rounded-md border border-teal-400/30 bg-teal-400/5 px-3 py-2 font-mono text-[11px] text-teal-400">
                You&apos;re invited to <strong>{invite.organizationName}</strong> as {invite.role}.
              </div>
              <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-text">
                Accept your invitation
              </h1>
              <p className="mt-2 text-sm text-muted">
                Finish creating your account to join the workspace.
              </p>
              <SignUpForm
                invite={{
                  id: invite.id,
                  token: inviteToken!,
                  email: invite.email,
                }}
              />
            </>
          ) : (
            <>
              <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight text-text">
                Create your account
              </h1>
              <p className="mt-2 text-sm text-muted">
                Use your work email. We&apos;ll send a link to verify it.
              </p>

              <SignUpForm />

              <div className="relative my-6 flex items-center">
                <span className="h-px flex-1 bg-white/10" />
                <span className="px-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                  or
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <SsoButtons mode="sign-up" />

              <p className="mt-6 text-center text-[12px] text-muted">
                Already have an account?{" "}
                <Link href="/sign-in" className="text-teal hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
