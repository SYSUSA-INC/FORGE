import Link from "next/link";
import { MFA_METHOD_LABELS } from "@/lib/mfa-constants";
import { missingMethodsOf } from "@/lib/mfa-store";
import { safeQuery } from "@/lib/schema-resilience";

/**
 * BL-MFA-RECOVERY — a platform superadmin keeps two ways in (a passkey
 * and an authenticator app) so one that stops working never locks them
 * out. While one is missing, every page says so and links to Security;
 * it never blocks the way in. Server component; nothing for others.
 */
export async function MfaMissingBanner({ userId, isSuperadmin }: { userId: string | null; isSuperadmin: boolean }) {
  if (!userId || !isSuperadmin) return null;
  const missing = await safeQuery(() => missingMethodsOf(userId), [], { tag: "shell.mfa-missing" });
  if (missing.length === 0) return null;
  return (
    <div role="status" className="flex w-full flex-wrap items-center justify-center gap-x-2 border-b border-brass/40 bg-brass/10 px-3 py-1 font-body text-[12px] text-text">
      <span>Platform administrators keep two ways in. Add {missing.map((m) => MFA_METHOD_LABELS[m]).join(" and ")} so one that stops working never locks you out.</span>
      <Link href="/settings/security" className="aur-link font-mono text-[11px] uppercase tracking-widest">
        Add it now
      </Link>
    </div>
  );
}
