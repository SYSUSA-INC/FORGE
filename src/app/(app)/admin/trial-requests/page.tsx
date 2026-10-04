import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { TRIAL_DAYS } from "@/lib/trial-logic";
import { listTrialRequests } from "@/lib/trial-requests";
import { TrialRequestsClient } from "./TrialRequestsClient";

export const dynamic = "force-dynamic";

/**
 * BL-AUTH-ABUSE Slice 2b — platform admins decide Request-a-trial
 * submissions. Approving creates the workspace with its admin invite and
 * a 14-day trial; declining sends nothing.
 */
export default async function TrialRequestsPage() {
  await requireSuperadmin();
  const { pending, decided } = await listTrialRequests();
  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Trials"
        title="Trial requests"
        subtitle={`People who asked to try FORGE from the public Request-a-trial page (company email only). Approve to create their workspace, invite them as its admin and start a ${TRIAL_DAYS}-day trial; when it ends, editing carries on and AI pauses until they choose a plan.`}
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost text-[11px]">
            ← SuperAdmin portal
          </Link>
        }
        meta={[{ label: "Pending", value: String(pending.length), accent: pending.length > 0 ? "gold" : undefined }]}
      />
      <TrialRequestsClient pending={pending} decided={decided} />
    </>
  );
}
