"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { memberships, opportunities, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { deleteContact, logTouch, saveContact, type ContactInput, type TouchInput } from "@/lib/crm";
import { agencyProcurementHistory, type AgencyProcurementHistory } from "@/lib/crm-history";

function revalidateCrm(contactId?: string | null) {
  revalidatePath("/contacts");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
  // The "who we know here" panel on every opportunity overview.
  revalidatePath("/opportunities/[id]", "page");
}

/** BL-FB-X-CRM — create (no `contactId`) or update a customer contact. */
export async function saveContactAction(input: ContactInput & { contactId?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const { contactId, ...rest } = input;
  const res = await saveContact({ organizationId, contactId: contactId ?? null, input: rest, actor: { userId: actor.id, email: actor.email } });
  if (res.ok) revalidateCrm(res.id);
  return res;
}

export async function deleteContactAction(contactId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await deleteContact({ organizationId, contactId, actor: { userId: actor.id, email: actor.email } });
  if (res.ok) revalidateCrm();
  return res;
}

/** BL-FB-X-CRM — log a meeting, call, email or note against a contact. */
export async function logTouchAction(input: TouchInput & { contactId: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const { contactId, ...rest } = input;
  const res = await logTouch({ organizationId, contactId, input: rest, actor: { userId: actor.id, email: actor.email } });
  if (res.ok) revalidateCrm(contactId);
  return res;
}

/** BL-FB-X-CRM Slice 2 — what this agency has been buying, from USAspending, on demand. */
export async function agencyHistoryAction(agency: string): Promise<AgencyProcurementHistory> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return agencyProcurementHistory({ organizationId, agency, actor: { userId: actor.id, email: actor.email } });
}

/** Active members, for the relationship-owner picker. */
export async function listContactOwners() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")));
}

/** Recent opportunities, for tying a touch to the pursuit it served. */
export async function listTouchOpportunities() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return db
    .select({ id: opportunities.id, title: opportunities.title, agency: opportunities.agency })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId))
    .orderBy(desc(opportunities.updatedAt))
    .limit(100);
}
