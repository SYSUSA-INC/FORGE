"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  memberships,
  opportunities,
  users,
  type OpportunityStage,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

export type OpportunityInput = {
  title: string;
  agency?: string;
  office?: string;
  stage?: OpportunityStage;
  solicitationNumber?: string;
  noticeId?: string;
  valueLow?: string;
  valueHigh?: string;
  releaseDate?: string | null;
  responseDueDate?: string | null;
  awardDate?: string | null;
  naicsCode?: string;
  pscCode?: string;
  setAside?: string;
  contractType?: string;
  placeOfPerformance?: string;
  incumbent?: string;
  description?: string;
  pWin?: number;
  ownerUserId?: string | null;
};

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toRow(input: OpportunityInput) {
  return {
    title: input.title.trim(),
    agency: input.agency?.trim() ?? "",
    office: input.office?.trim() ?? "",
    stage: input.stage ?? "identified",
    solicitationNumber: input.solicitationNumber?.trim() ?? "",
    noticeId: input.noticeId?.trim() ?? "",
    valueLow: input.valueLow?.trim() ?? "",
    valueHigh: input.valueHigh?.trim() ?? "",
    releaseDate: parseDate(input.releaseDate ?? null),
    responseDueDate: parseDate(input.responseDueDate ?? null),
    awardDate: parseDate(input.awardDate ?? null),
    naicsCode: input.naicsCode?.trim() ?? "",
    pscCode: input.pscCode?.trim() ?? "",
    setAside: input.setAside?.trim() ?? "",
    contractType: input.contractType?.trim() ?? "",
    placeOfPerformance: input.placeOfPerformance?.trim() ?? "",
    incumbent: input.incumbent?.trim() ?? "",
    description: input.description?.trim() ?? "",
    pWin: typeof input.pWin === "number" ? Math.max(0, Math.min(100, Math.round(input.pWin))) : 0,
    ownerUserId: input.ownerUserId ?? null,
  };
}

export async function createOpportunityAction(
  input: OpportunityInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.title?.trim()) {
    return { ok: false, error: "Title is required." };
  }

  try {
    const [row] = await db
      .insert(opportunities)
      .values({
        ...toRow(input),
        organizationId,
        createdByUserId: actor.id,
      })
      .returning({ id: opportunities.id });
    if (!row) return { ok: false, error: "Could not create opportunity." };

    revalidatePath("/opportunities");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[createOpportunityAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function updateOpportunityAction(
  id: string,
  input: OpportunityInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.title?.trim()) {
    return { ok: false, error: "Title is required." };
  }

  try {
    await db
      .update(opportunities)
      .set({ ...toRow(input), updatedAt: new Date() })
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.organizationId, organizationId),
        ),
      );
    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateOpportunityAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function setOpportunityStageAction(
  id: string,
  stage: OpportunityStage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await db
      .update(opportunities)
      .set({ stage, updatedAt: new Date() })
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.organizationId, organizationId),
        ),
      );
    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[setOpportunityStageAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Stage change failed.",
    };
  }
}

export async function deleteOpportunityAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await db
      .delete(opportunities)
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.organizationId, organizationId),
        ),
      );
    revalidatePath("/opportunities");
    return { ok: true };
  } catch (err) {
    console.error("[deleteOpportunityAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Delete failed.",
    };
  }
}

export async function createOpportunityAndGoAction(
  input: OpportunityInput,
): Promise<void> {
  const res = await createOpportunityAction(input);
  if (res.ok) redirect(`/opportunities/${res.id}`);
  throw new Error(res.ok ? "unreachable" : res.error);
}

export async function listOpportunityOwners(): Promise<
  { id: string; name: string | null; email: string }[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));
  void desc;
  return rows;
}
