import Link from "next/link";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { getCurrentTier } from "@/lib/subscription-gates";
import { trialBannerText } from "@/lib/trial-logic";

/**
 * BL-AUTH-ABUSE Slice 2a — one line under the top bar while a workspace
 * is on a trial: days left, and once it has ended, that editing carries
 * on and AI is paused, with the way to Billing. Renders nothing for
 * workspaces not on a trial. Server component; reads through the gate.
 */
export async function TrialBanner({ hasWorkspace }: { hasWorkspace: boolean }) {
  if (!hasWorkspace) return null;
  const { organizationId } = await requireCurrentOrg();
  const tier = await getCurrentTier(organizationId);
  const banner = tier ? trialBannerText(tier.trial) : null;
  if (!banner) return null;
  const tone =
    banner.tone === "ended"
      ? "border-rose/40 bg-rose/10 text-rose-300"
      : banner.tone === "warn"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : "border-indigo-400/30 bg-indigo-400/10 text-indigo-300";
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5 font-mono text-[11px] md:px-6 ${tone}`}>
      <span>{banner.text}</span>
      <Link href="/settings/billing" className="underline-offset-2 hover:underline">
        Choose a plan →
      </Link>
    </div>
  );
}
