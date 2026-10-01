import { getOnboardingState } from "@/lib/onboarding";
import { GettingStartedClient } from "./GettingStartedClient";

/**
 * BL-AIP-7d part ii — "Getting started": shown to org admins on the
 * Command Center until the organization has a UEI, its NAICS, scout
 * keywords and a capability statement. Renders nothing otherwise.
 */
export async function GettingStartedPanel({
  organizationId,
  isOrgAdmin,
}: {
  organizationId: string;
  isOrgAdmin: boolean;
}) {
  if (!isOrgAdmin) return null;
  const state = await getOnboardingState({ organizationId }).catch(() => null);
  if (!state || state.status.complete) return null;
  return <GettingStartedClient state={state} />;
}
