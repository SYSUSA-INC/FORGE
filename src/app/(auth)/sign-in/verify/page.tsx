import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { passkeyCount } from "@/lib/passkeys";
import { safeRedirectTarget } from "@/lib/safe-redirect";
import { GATE_PATHS } from "@/lib/session-policy";
import { VerifyForm } from "./VerifyForm";

/**
 * BL-STAB-8a-2 — the second step: a code from the authenticator app, or
 * a recovery code; 8a-3 — or a passkey. Reached only between the password (or Google /
 * Microsoft) step and the app; a session that is already in goes on,
 * one with no factor goes to enrol, none at all goes to sign in.
 */
export default async function VerifyPage({ searchParams }: { searchParams: { callbackUrl?: string } }) {
  const target = safeRedirectTarget(searchParams.callbackUrl);
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (session.user.mfa === "ok") redirect(target);
  if (session.user.mfa === "enrol") redirect(`${GATE_PATHS.enrol}?callbackUrl=${encodeURIComponent(target)}`);
  const hasPasskey = (await passkeyCount(session.user.id)) > 0;

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-12">
      <div className="aur-card w-full max-w-md overflow-hidden">
        <div className="px-8 py-10">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Second step</h1>
          <p className="mt-2 text-sm text-muted">
            Signed in as <span className="text-text">{session.user.email}</span>. {hasPasskey ? "Use your passkey, or enter" : "Enter"} the six-digit code from your authenticator app, or one of your recovery codes.
          </p>
          <VerifyForm callbackUrl={target} hasPasskey={hasPasskey} />
          <form
            className="mt-6"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          >
            <button type="submit" className="aur-link font-mono text-[10px] uppercase tracking-widest">
              Not you? Sign out
            </button>
          </form>
          <p className="mt-4 font-body text-[12px] leading-[1.5] text-muted">You have ten minutes from signing in. Lost your phone and your codes? Ask a platform administrator to reset your two-step sign-in.</p>
        </div>
      </div>
    </div>
  );
}
