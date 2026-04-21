import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { SignUpForm } from "./SignUpForm";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: { sent?: string };
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const pending = searchParams.sent === "1";

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
          ) : (
            <>
              <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight text-text">
                Create your account
              </h1>
              <p className="mt-2 text-sm text-muted">
                Use your work email. We&apos;ll send a link to verify it.
              </p>

              <SignUpForm />

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
