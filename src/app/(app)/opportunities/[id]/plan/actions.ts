"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { isPlanColorTeam, isPlanRole, isRaciArea, isRaciLetter } from "@/lib/plan-logic";
import { addPlanRole, removePlanRole, setPlanRaci } from "@/lib/plan-store";

type Result = { ok: true; id?: string } | { ok: false; error: string };

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
