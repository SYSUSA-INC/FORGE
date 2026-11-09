import { notFound } from "next/navigation";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { loadSchedule } from "@/lib/milestone-store";
import { loadCharterPanel } from "@/lib/plan-charter-store";
import { listPlanMembers, loadPlan } from "@/lib/plan-store";
import { loadParts } from "@/lib/section-plan-store";
import { PlanClient } from "./PlanClient";

export const dynamic = "force-dynamic";

/**
 * BL-NAV-LIFECYCLE phase 4a (FORGE II footnote 7, P-1 to P-3) — the
 * opportunity's Plan tab: the team with its RACI and the colour teams.
 * The first visit creates the plan and seeds the team from the
 * solicitation's assignments; every visit keeps the two in step.
 * Phase 4b-1 (P-5) adds the schedule: the milestones, built by the
 * count-back from the due date and moved by the manager. Phase 4b-2
 * (P-4) draws the schedule as a timeline and adds the parts: the
 * proposals' sections with an owner and a due date each.
 */
export default async function OpportunityPlanPage({ params }: { params: { id: string } }) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [plan, members, schedule, parts] = await Promise.all([
    loadPlan({ organizationId, opportunityId: params.id, actor: { userId: user.id, email: user.email, name: user.name } }),
    listPlanMembers(organizationId),
    loadSchedule({ organizationId, opportunityId: params.id }),
    loadParts({ organizationId, opportunityId: params.id }),
  ]);
  // After the plan: the first visit creates it.
  const charter = plan ? await loadCharterPanel({ organizationId, opportunityId: params.id }) : null;
  if (!plan || !schedule || !parts || !charter) notFound();
  return <PlanClient opportunityId={params.id} plan={plan} members={members} schedule={schedule} parts={parts} charter={charter} />;
}
