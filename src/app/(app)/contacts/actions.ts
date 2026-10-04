"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { memberships, opportunities, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordRead } from "@/lib/audit-log";
import { deleteContact, logTouch, saveContact, type ContactInput, type TouchInput } from "@/lib/crm";
import { agencyProcurementHistory, cachedAgencyHistory, type AgencyProcurementHistory } from "@/lib/crm-history";
import { commitContactImport, previewContactImport, type ImportCommit, type ImportPreview } from "@/lib/crm-import";
import type { ImportRow } from "@/lib/crm-import-logic";

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

/** BL-FB-X-CRM Slice 2 — what this agency has been buying, from USAspending, on demand (Slice 3: cached a day; `force` refreshes). */
export async function agencyHistoryAction(agency: string, force = false): Promise<AgencyProcurementHistory> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return agencyProcurementHistory({ organizationId, agency, actor: { userId: actor.id, email: actor.email }, force: force === true });
}

/** BL-FB-X-CRM Slice 3 — the cached answer for this agency, if the tenant fetched one; no external call. */
export async function cachedAgencyHistoryAction(agency: string): Promise<AgencyProcurementHistory | null> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return cachedAgencyHistory({ organizationId, agency: String(agency ?? "") });
}

/** BL-FB-X-CRM Slice 3 — parse a pasted or uploaded CSV / vCard and mark the people we already have. Writes nothing. */
export async function previewContactImportAction(input: { text: string; fileName?: string }): Promise<ImportPreview> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return previewContactImport({ organizationId, text: String(input.text ?? ""), fileName: typeof input.fileName === "string" ? input.fileName : "" });
}

/** BL-FB-X-CRM Slice 3 — write the previewed rows; duplicates skipped or updated. Audited. */
export async function commitContactImportAction(input: { rows: Partial<ImportRow>[]; duplicates: "skip" | "update" }): Promise<ImportCommit> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await commitContactImport({
    organizationId,
    rows: Array.isArray(input.rows) ? input.rows : [],
    duplicates: input.duplicates === "update" ? "update" : "skip",
    actor: { userId: actor.id, email: actor.email },
  });
  if (res.ok) revalidateCrm();
  return res;
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

/**
 * BL-FB-X-CRM Slice 4 — the contact list is about to be downloaded as CSV
 * (built in the browser from the rows on screen). A list of named
 * government contacts leaving the platform is a sensitive read: recorded.
 */
export async function recordContactExportAction(input: { count: number; filtered: boolean }): Promise<{ ok: true }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await recordRead({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "crm.contacts.export",
    resourceType: "customer_contact",
    resourceId: "list",
    metadata: { count: Math.max(0, Math.floor(Number(input.count) || 0)), filtered: !!input.filtered },
  });
  return { ok: true };
}
