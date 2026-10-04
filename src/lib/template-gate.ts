/**
 * BL-16 customTemplates — what the flag gates: authoring templates
 * (create, edit, upload or clear the Word file, switch mode). Using the
 * templates a workspace already has — on /proposals/new, as the default,
 * archive / unarchive — is never gated, so nothing already built is lost.
 */
import "server-only";

import { ensureFeature, FeatureGateError } from "@/lib/subscription-gates";

export const TEMPLATE_AUTHORING_REFUSAL =
  "Custom templates aren't included in this workspace's plan. Your existing templates still work for new proposals; an admin can add custom templates under Settings → Billing.";

/** Why the plan refuses template authoring, or null when it allows it. */
export async function templateAuthoringRefusal(organizationId: string): Promise<string | null> {
  try {
    await ensureFeature(organizationId, "customTemplates");
    return null;
  } catch (err) {
    if (err instanceof FeatureGateError) return TEMPLATE_AUTHORING_REFUSAL;
    throw err;
  }
}
