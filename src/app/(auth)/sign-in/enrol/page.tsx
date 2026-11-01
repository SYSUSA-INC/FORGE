import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { SecurityPanel } from "@/app/(app)/settings/security/SecurityPanel";
import { getMfaStatus } from "@/lib/mfa-store";
import { superadminNeedsPasskey } from "@/lib/passkeys";
import { safeRedirectTarget } from "@/lib/safe-redirect";
import { GATE_PATHS } from "@/lib/session-policy";

/**
 * BL-STAB-8a-2 — the first sign-in after release, or after a reset: no
 * factor yet, so the person sets one up before anything opens. The same
 * panel as Settings → Security; confirming the first code (or
 * registering the passkey, 8a-3) counts as the second step for this
 * sign-in.
 */
export default async function EnrolPage({ searchParams }: { searchParams: { callbackUrl?: string } }) {
  const target = safeRedirectTarget(searchParams.callbackUrl);
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (session.user.mfa === "ok") redirect(target);
  if (session.user.mfa === "pending") redirect(`${GATE_PATHS.verify}?callbackUrl=${encodeURIComponent(target)}`);
  const status = await getMfaStatus(session.user.id);
  // BL-STAB-8a-3 — a platform superadmin is here until they hold a passkey.
  const requirePasskey = await superadminNeedsPasskey(session.user.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-2 py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Set up two-step sign-in</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        FORGE now asks for a second step at every sign-in. {requirePasskey ? "Add a passkey" : "Add a passkey or an authenticator app"} for <span className="text-text">{session.user.email}</span>, save the recovery codes it comes with, and you are in. This takes about a minute.
      </p>
      <div className="mt-6">
        <SecurityPanel
          email={session.user.email ?? ""}
          factors={status.factors.map((f) => ({ id: f.id, kind: f.kind, label: f.label, createdAt: f.createdAt.toISOString().slice(0, 10), lastUsedAt: f.lastUsedAt ? f.lastUsedAt.toISOString().slice(0, 10) : null }))}
          recoveryCodesLeft={status.recoveryCodesLeft}
          available={status.available}
          continueHref={target}
          requirePasskey={requirePasskey}
        />
      </div>
      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/sign-in" });
        }}
      >
        <button type="submit" className="aur-link font-mono text-[10px] uppercase tracking-widest">
          Not now, sign out
        </button>
      </form>
    </div>
  );
}
