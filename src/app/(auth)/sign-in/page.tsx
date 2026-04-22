import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { SsoButtons } from "@/components/auth/SsoButtons";
import { SignInForm } from "./SignInForm";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { error?: string; callbackUrl?: string; verified?: string };
}) {
  const session = await auth();
  if (session?.user) {
    redirect(searchParams.callbackUrl ?? "/");
  }

  const verified = searchParams.verified === "1";
  const error = searchParams.error;

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

          <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight text-text">
            Sign in to Forge
          </h1>
          <p className="mt-2 text-sm text-muted">
            Use your email and password.
          </p>

          {verified ? (
            <div className="mt-6 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
              Email verified. You can now sign in.
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {errorMessage(error)}
            </div>
          ) : null}

          <SignInForm callbackUrl={searchParams.callbackUrl} />

          <div className="relative my-6 flex items-center">
            <span className="h-px flex-1 bg-white/10" />
            <span className="px-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              or
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <SsoButtons callbackUrl={searchParams.callbackUrl} mode="sign-in" />

          <div className="mt-4 flex justify-between font-mono text-[11px]">
            <Link href="/forgot-password" className="text-muted hover:text-text">
              Forgot password?
            </Link>
            <Link href="/sign-up" className="text-teal hover:underline">
              Create account
            </Link>
          </div>

          <p className="mt-8 text-center text-[11px] text-subtle">
            By signing in you agree to the FORGE terms of service.
          </p>
        </div>
      </div>
    </div>
  );
}

function errorMessage(error: string): string {
  switch (error) {
    case "CredentialsSignin":
      return "Invalid email or password.";
    case "AccessDenied":
      return "Access denied. Your account is not authorized.";
    case "Verification":
      return "Sign-in link expired or already used.";
    case "Configuration":
      return "Authentication is not configured correctly. Contact an administrator.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
