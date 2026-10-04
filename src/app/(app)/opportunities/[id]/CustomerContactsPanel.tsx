import { AgencyContactsView } from "@/components/crm/AgencyContactsPanel";
import { contactsForOpportunity } from "@/lib/crm";

/**
 * BL-FB-X-CRM — "who do we know here" on the opportunity overview: the
 * contacts at this opportunity's agency, warmest first, before anyone
 * starts writing. Renders nothing when the opportunity has no agency.
 */
export async function CustomerContactsPanel({ organizationId, opportunityId }: { organizationId: string; opportunityId: string }) {
  const { agency, contacts } = await contactsForOpportunity({ organizationId, opportunityId });
  if (!agency.trim()) return null;
  return <AgencyContactsView agency={agency} contacts={contacts} />;
}
