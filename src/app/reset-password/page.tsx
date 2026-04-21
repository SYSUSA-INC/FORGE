import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string; email?: string; done?: string };
}) {
  const token = searchParams.token ?? "";
  const email = searchParams.email ?? "";
  const done = searchParams.done === "1";

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
          {done ? (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
                Password updated
              </h1>
              <p className="mt-2 text-sm text-muted">
                Your password has been changed. Sign in with the new one.
              </p>
              <Link
                href="/sign-in"
                className="aur-btn aur-btn-primary mt-6 flex w-full items-center justify-center py-3 text-sm"
              >
                Sign in
              </Link>
            </>
          ) : !token || !email ? (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
                Invalid link
              </h1>
              <p className="mt-2 text-sm text-muted">
                This reset link is malformed. Request a new one from the forgot-password page.
              </p>
              <Link
                href="/forgot-password"
                className="aur-btn aur-btn-ghost mt-6 flex w-full items-center justify-center py-3 text-sm"
              >
                Request new link
              </Link>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
                Choose a new password
              </h1>
              <p className="mt-2 text-sm text-muted">For {email}.</p>
              <ResetPasswordForm token={token} email={email} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
