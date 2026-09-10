import Link from "next/link";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { getIntegrationStatuses } from "@/lib/settings-status";
import { IntegrationsTab } from "../IntegrationsTab";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  await requireCurrentOrg();

  const integrations = getIntegrationStatuses();

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        subtitle="External APIs and connectors used across capture and proposal workflows. Provision API keys in your deployment environment to activate."
        actions={
          <Link href="/settings" className="aur-btn aur-btn-ghost">
            ← Settings
          </Link>
        }
      />
      <IntegrationsTab integrations={integrations} />
    </>
  );
}
