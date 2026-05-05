import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { listAllSourceRequestsAction } from "@/app/(app)/opportunities/import/source-requests/actions";
import { SourceRequestTriageClient } from "./SourceRequestTriageClient";

export const dynamic = "force-dynamic";

export default async function PlatformSourceRequestsPage() {
  await requireSuperadmin();

  const requests = await listAllSourceRequestsAction();

  const counts = {
    pending: requests.filter((r) => r.status === "pending").length,
    under_review: requests.filter((r) => r.status === "under_review").length,
    shipped: requests.filter((r) => r.status === "shipped").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="Source requests"
        subtitle="Customer-suggested opportunity sources. Triage, set status, and leave notes — these are the inputs to platform-roadmap decisions."
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost">
            ← Platform admin
          </Link>
        }
        meta={[
          {
            label: "Pending",
            value: String(counts.pending).padStart(2, "0"),
            accent: counts.pending > 0 ? "gold" : undefined,
          },
          {
            label: "Under review",
            value: String(counts.under_review).padStart(2, "0"),
            accent: counts.under_review > 0 ? "cobalt" : undefined,
          },
          {
            label: "Shipped",
            value: String(counts.shipped).padStart(2, "0"),
            accent: counts.shipped > 0 ? "emerald" : undefined,
          },
          {
            label: "Rejected",
            value: String(counts.rejected).padStart(2, "0"),
          },
        ]}
      />
      <SourceRequestTriageClient initialRequests={requests} />
    </>
  );
}
