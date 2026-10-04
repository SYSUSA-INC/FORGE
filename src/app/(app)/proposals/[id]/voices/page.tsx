import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { proposalVoices } from "@/lib/voice";
import { VoicesClient } from "./VoicesClient";

export const dynamic = "force-dynamic";

/**
 * BL-FB-GEN-VOICE Slice 3 — how each author writes on this proposal, and
 * where two of them differ enough for an evaluator to notice the change
 * of hands. Measured from their sections on this proposal only.
 */
export default async function ProposalVoicesPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const authors = await proposalVoices({ organizationId, proposalId: params.id });
  return <VoicesClient authors={authors} />;
}
