import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: { sent?: string };
}) {
  const sent = searchParams.sent === "1";

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
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
            {sent ? "Check your inbox" : "Reset your password"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {sent
              ? "If an account exists for that email, we sent a password reset link. The link expires in 1 hour."
              : "Enter the email you used to sign up. We'll send you a reset link."}
          </p>

          {sent ? (
            <Link
              href="/sign-in"
              className="aur-btn aur-btn-ghost mt-6 flex w-full items-center justify-center py-3 text-sm"
            >
              Back to sign in
            </Link>
          ) : (
            <>
              <ForgotPasswordForm />
              <p className="mt-6 text-center text-[12px] text-muted">
                Remember it?{" "}
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
