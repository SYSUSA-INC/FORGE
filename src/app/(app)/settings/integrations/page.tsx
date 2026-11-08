import Link from "next/link";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { getSamKeyStatus } from "@/lib/samgov-key";
import { samKeyNotice } from "@/lib/samgov-key-logic";
import { getIntegrationStatuses } from "@/lib/settings-status";
import { IntegrationsTab } from "../IntegrationsTab";
import { SamGovKeyPanel, type SamKeyPanelView } from "./SamGovKeyPanel";
import { BidEmailPanel } from "./BidEmailPanel";
import { getInboundAddress } from "@/lib/inbound-email";
import { receivingConfigured } from "@/lib/inbound-email-logic";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { user, organizationId, isImpersonating } = await requireCurrentOrg();

  const integrations = getIntegrationStatuses();
  // BL-STAB-7b — the company's SAM.gov key: details only for admins who can edit it.
  const sam = await getSamKeyStatus(organizationId);
  const canEdit = (user.role === "admin" || user.isSuperadmin) && !isImpersonating;
  const samView: SamKeyPanelView = {
    inUse: sam.inUse,
    platformConfigured: sam.platformConfigured,
    canSave: sam.canSave,
    dbReady: sam.dbReady,
    company:
      canEdit && sam.company
        ? {
            last4: sam.company.last4,
            status: sam.company.status,
            statusAt: sam.company.statusAt.toISOString(),
            verifiedAt: sam.company.verifiedAt?.toISOString() ?? null,
            setAt: sam.company.setAt.toISOString(),
            setByName: sam.company.setByName,
            readable: sam.company.readable,
          }
        : null,
    notice: canEdit ? null : samKeyNotice(sam),
  };

  const inbound = await getInboundAddress(organizationId);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        subtitle="Your company's SAM.gov API key is set here. The other services run on credentials managed by the FORGE team."
        actions={
          <Link href="/settings" className="aur-link">
            ← Settings
          </Link>
        }
      />
      <SamGovKeyPanel view={samView} canEdit={canEdit} isImpersonating={isImpersonating} />
      {/* BL-SCOUT-INBOX — the address portals mail bid alerts to. */}
      <div className="mt-4">
        <BidEmailPanel address={inbound?.address ?? null} configured={receivingConfigured()} canEdit={canEdit} />
      </div>
      <IntegrationsTab integrations={integrations} />
    </>
  );
}
