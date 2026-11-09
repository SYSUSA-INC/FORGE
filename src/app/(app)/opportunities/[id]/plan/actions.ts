"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { isPlanColorTeam, isPlanRole, isRaciArea, isRaciLetter } from "@/lib/plan-logic";
import { isIsoDay, isMilestoneKind, isMilestoneStatus } from "@/lib/milestone-logic";
import { addMilestone, buildSchedule, removeMilestone, updateMilestone, type MilestonePatch } from "@/lib/milestone-store";
import { addPlanRole, removePlanRole, setPlanRaci } from "@/lib/plan-store";
import { setPartDueDate, setPartOwner } from "@/lib/section-plan-store";

type Result = { ok: true; id?: string; added?: number } | { ok: false; error: string };

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/plan`);
  revalidatePath("/pipeline/plan");
}

async function who() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return { organizationId, actor: { userId: actor.id, email: actor.email, name: actor.name } };
}

/** BL-NAV-LIFECYCLE 4a — name a person to a role, or a colour team, on the opportunity's plan. */
export async function addPlanRoleAction(input: { opportunityId: string; userId: string; role: string; colorTeam?: string | null; notes?: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const role = String(input?.role ?? "");
  if (!isPlanRole(role)) return { ok: false, error: "Choose a role." };
  const color = String(input?.colorTeam ?? "");
  if (role === "color_team_reviewer" && color && !isPlanColorTeam(color)) return { ok: false, error: "Choose a colour team." };
  const res = await addPlanRole({
    organizationId,
    opportunityId: String(input?.opportunityId ?? ""),
    userId: String(input?.userId ?? ""),
    role,
    colorTeam: role === "color_team_reviewer" && isPlanColorTeam(color) ? color : null,
    notes: String(input?.notes ?? "").trim().slice(0, 500),
    actor,
  });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function removePlanRoleAction(input: { opportunityId: string; roleId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await removePlanRole({ organizationId, opportunityId: String(input?.opportunityId ?? ""), roleId: String(input?.roleId ?? ""), actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function setPlanRaciAction(input: { opportunityId: string; roleId: string; area: string; letter: string | null }): Promise<Result> {
  const { organizationId, actor } = await who();
  const area = String(input?.area ?? "");
  if (!isRaciArea(area)) return { ok: false, error: "Choose an area." };
  const letter = input?.letter ? String(input.letter) : "";
  if (letter && !isRaciLetter(letter)) return { ok: false, error: "Choose R, A, C or I." };
  const res = await setPlanRaci({ organizationId, opportunityId: String(input?.opportunityId ?? ""), roleId: String(input?.roleId ?? ""), area, letter: isRaciLetter(letter) ? letter : null, actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

// ---------------------------------------------------------------------------
// BL-NAV-LIFECYCLE 4b-1 — the schedule: Build the schedule, add, move / mark, remove.
// ---------------------------------------------------------------------------

function cleanPatch(input: { title?: string; date?: string; ownerUserId?: string | null; status?: string; notes?: string }): { patch: MilestonePatch } | { error: string } {
  const patch: MilestonePatch = {};
  if (input.title !== undefined) {
    const title = String(input.title).trim().slice(0, 200);
    if (!title) return { error: "Give the milestone a title." };
    patch.title = title;
  }
  if (input.date !== undefined) {
    const date = String(input.date);
    if (!isIsoDay(date)) return { error: "Choose a day." };
    patch.date = date;
  }
  if (input.ownerUserId !== undefined) patch.ownerUserId = input.ownerUserId ? String(input.ownerUserId) : null;
  if (input.status !== undefined) {
    const status = String(input.status);
    if (!isMilestoneStatus(status)) return { error: "Choose planned, done or missed." };
    patch.status = status;
  }
  if (input.notes !== undefined) patch.notes = String(input.notes).trim().slice(0, 500);
  return { patch };
}

/** Proposes the count-back schedule from the due date and writes the milestones the plan lacks. */
export async function buildScheduleAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await buildSchedule({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function addMilestoneAction(input: { opportunityId: string; title: string; kind: string; date: string; ownerUserId?: string | null; notes?: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const kind = String(input?.kind ?? "");
  if (!isMilestoneKind(kind)) return { ok: false, error: "Choose what the milestone marks." };
  const cleaned = cleanPatch({ title: input?.title ?? "", date: input?.date ?? "", ownerUserId: input?.ownerUserId ?? null, notes: input?.notes ?? "" });
  if ("error" in cleaned) return { ok: false, error: cleaned.error };
  const res = await addMilestone({
    organizationId,
    opportunityId: String(input?.opportunityId ?? ""),
    title: cleaned.patch.title!,
    kind,
    date: cleaned.patch.date!,
    ownerUserId: cleaned.patch.ownerUserId ?? null,
    notes: cleaned.patch.notes ?? "",
    actor,
  });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function updateMilestoneAction(input: { opportunityId: string; milestoneId: string; title?: string; date?: string; ownerUserId?: string | null; status?: string; notes?: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const cleaned = cleanPatch(input ?? {});
  if ("error" in cleaned) return { ok: false, error: cleaned.error };
  const res = await updateMilestone({ organizationId, opportunityId: String(input?.opportunityId ?? ""), milestoneId: String(input?.milestoneId ?? ""), patch: cleaned.patch, actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function removeMilestoneAction(input: { opportunityId: string; milestoneId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await removeMilestone({ organizationId, opportunityId: String(input?.opportunityId ?? ""), milestoneId: String(input?.milestoneId ?? ""), actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

// ---------------------------------------------------------------------------
// BL-NAV-LIFECYCLE 4b-2 — the parts: the owner and the due date per section.
// ---------------------------------------------------------------------------

function refreshParts(opportunityId: string, proposalId: string) {
  refresh(opportunityId);
  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath(`/proposals/${proposalId}/sections`);
}

/** Names the part's owner (the section author); the owner is told, with the date, when it is someone else. */
export async function setPartOwnerAction(input: { opportunityId: string; proposalId: string; sectionId: string; authorUserId: string | null }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await setPartOwner({ organizationId, opportunityId: String(input?.opportunityId ?? ""), sectionId: String(input?.sectionId ?? ""), authorUserId: input?.authorUserId ? String(input.authorUserId) : null, actor });
  if (res.ok) refreshParts(input.opportunityId, String(input?.proposalId ?? ""));
  return res;
}

/** Sets or clears the day the part is due. */
export async function setPartDueDateAction(input: { opportunityId: string; proposalId: string; sectionId: string; dueDate: string | null }): Promise<Result> {
  const { organizationId, actor } = await who();
  const dueDate = input?.dueDate ? String(input.dueDate) : null;
  if (dueDate && !isIsoDay(dueDate)) return { ok: false, error: "Choose a day." };
  const res = await setPartDueDate({ organizationId, opportunityId: String(input?.opportunityId ?? ""), sectionId: String(input?.sectionId ?? ""), dueDate, actor });
  if (res.ok) refreshParts(input.opportunityId, String(input?.proposalId ?? ""));
  return res;
}
