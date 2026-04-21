import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { consumeToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: { token?: string; email?: string };
}) {
  const token = searchParams.token ?? "";
  const email = (searchParams.email ?? "").toLowerCase().trim();

  let state: "success" | "invalid" | "missing" = "missing";

  if (token && email) {
    const ok = await consumeToken("verify-email", email, token);
    if (ok) {
      await db
        .update(users)
        .set({ emailVerified: new Date(), updatedAt: new Date() })
        .where(eq(users.email, email));
      state = "success";
    } else {
      state = "invalid";
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-12">
      <div className="aur-card-elevated w-full max-w-md overflow-hidden">
        <div
          className="h-[2px] w-full"
          style={{
            background:
              state === "success"
                ? "linear-gradient(90deg, #34D399, #2DD4BF)"
                : "linear-gradient(90deg, #F43F5E, #EC4899)",
          }}
        />
        <div className="px-8 py-10">
          {state === "success" ? (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
                Email verified
              </h1>
              <p className="mt-2 text-sm text-muted">
                Your email address is confirmed. You can now sign in.
              </p>
              <Link
                href="/sign-in"
                className="aur-btn aur-btn-primary mt-6 flex w-full items-center justify-center py-3 text-sm"
              >
                Continue to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
                Verification failed
              </h1>
              <p className="mt-2 text-sm text-muted">
                {state === "invalid"
                  ? "This link is invalid or has expired. Request a new verification email by signing up again."
                  : "Missing token or email. Use the link sent to your inbox."}
              </p>
              <Link
                href="/sign-up"
                className="aur-btn aur-btn-ghost mt-6 flex w-full items-center justify-center py-3 text-sm"
              >
                Back to sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
