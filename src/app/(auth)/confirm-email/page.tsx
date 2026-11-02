import Link from "next/link";
import { recordAudit } from "@/lib/audit-log";
import { confirmEmailChange } from "@/lib/email-change-store";
import { sendEmailChangeNoticeEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { firstWorkspaceOf } from "@/lib/mfa-store";
import { ResendVerification } from "@/components/auth/ResendVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BL-STAB-8b-3 — the link from the new inbox. No session is needed: the
 * request was made signed in with a current code, and this click proves
 * the new address. On success every session of the person ended, so
 * the page sends them to sign in with the new address.
 */
export default async function ConfirmEmailPage({ searchParams }: { searchParams: { token?: string; email?: string } }) {
  const token = searchParams.token ?? "";
  const email = (searchParams.email ?? "").toLowerCase().trim();

  let state: "success" | "invalid" | "stale" | "taken" | "missing" = "missing";
  if (token && email) {
    const res = await confirmEmailChange({ email, token });
    if (res.ok) {
      state = "success";
      log.info("[email-change]", "address changed", { userId: res.userId });
      try {
        const organizationId = await firstWorkspaceOf(res.userId);
        if (organizationId) {
          await recordAudit({ organizationId, actor: { userId: res.userId, email: res.newEmail }, action: "user.email.change", resourceType: "user", resourceId: res.userId, metadata: { from: res.oldEmail, to: res.newEmail } });
        }
        await sendEmailChangeNoticeEmail({ to: res.oldEmail, newEmail: res.newEmail, confirmed: true });
      } catch (err) {
        log.warn("[email-change]", "audit or notice after the change failed", { userId: res.userId, error: err instanceof Error ? err.message : err });
      }
    } else {
      state = res.reason;
    }
  }

  const messages: Record<Exclude<typeof state, "success">, string> = {
    invalid: "This link is invalid, already used, or the change was cancelled. Request the change again from Settings → Security.",
    stale: "This link expired: a change of address is good for 24 hours. Request it again from Settings → Security.",
    taken: "That address was taken by another account in the meantime. Request the change again with a different address.",
    missing: "Missing token or email. Use the link sent to your new inbox.",
  };

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-12">
      <div className="aur-card w-full max-w-md overflow-hidden">
        <div className="px-8 py-10">
          {state === "success" ? (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Email address changed</h1>
              <p className="mt-2 text-sm text-muted">
                Your FORGE account now signs in as <span className="text-text">{email}</span>. Every open session was signed out; sign in again with the new address and your usual password and second step.
              </p>
              <Link href="/sign-in" className="aur-btn aur-btn-primary mt-6 flex w-full items-center justify-center py-3 text-sm">
                Sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Address not changed</h1>
              <p className="mt-2 text-sm text-muted">{messages[state]}</p>
              {state === "missing" ? <ResendVerification email={email} /> : null}
              <Link href="/sign-in" className="aur-btn aur-btn-ghost mt-6 flex w-full items-center justify-center py-3 text-sm">
                Go to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
