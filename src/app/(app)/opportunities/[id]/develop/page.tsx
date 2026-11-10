import { notFound } from "next/navigation";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { loadDevelop } from "@/lib/develop-store";
import { DevelopClient } from "./DevelopClient";

/**
 * BL-NAV-LIFECYCLE 5a (FORGE II D-1, D-3) — the opportunity's Develop tab:
 * Create a Draft from the plan, then the draft's readiness for Pink.
 */
export default async function OpportunityDevelopPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const view = await loadDevelop({ organizationId, opportunityId: params.id });
  if (!view) notFound();
  return <DevelopClient view={view} />;
}
