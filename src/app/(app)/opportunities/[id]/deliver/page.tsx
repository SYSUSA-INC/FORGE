import { notFound } from "next/navigation";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { loadDeliver } from "@/lib/deliver-store";
import { DeliverClient } from "./DeliverClient";

/**
 * BL-NAV-LIFECYCLE 6a (FORGE II S-1, S-2) — the opportunity's Deliver tab:
 * the colour-team sign-off, Record submission, and the submissions on
 * record.
 */
export default async function OpportunityDeliverPage({ params }: { params: { id: string } }) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const view = await loadDeliver({
    organizationId,
    opportunityId: params.id,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperadmin: user.isSuperadmin },
  });
  if (!view) notFound();
  return <DeliverClient view={view} />;
}
