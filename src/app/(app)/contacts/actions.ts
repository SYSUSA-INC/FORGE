"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { memberships, opportunities, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordRead } from "@/lib/audit-log";
import { deleteContact, logTouch, saveContact, type ContactInput, type TouchInput } from "@/lib/crm";
import { agencyProcurementHistory, cachedAgencyHistory, type AgencyProcurementHistory } from "@/lib/crm-history";
import { commitContactImport, findImportDuplicates, type DuplicateCheck, type ImportBatch, type ImportCommit } from "@/lib/crm-import";
import type { ImportPerson, ImportRow } from "@/lib/crm-import-logic";

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

/**
 * BL-FB-X-CRM Slice 3 — mark the people we already have, for the import
 * preview. BL-STAB-2f — the browser parses the file and sends only who
 * is in it (name, agency, email). Writes nothing.
 */
export async function findImportDuplicatesAction(input: { people: Partial<ImportPerson>[] }): Promise<DuplicateCheck> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return findImportDuplicates({ organizationId, people: Array.isArray(input?.people) ? input.people : [] });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A part number the audit can carry; anything else is dropped. */
function importBatch(raw: unknown): ImportBatch | undefined {
  const b = raw as Partial<ImportBatch> | null | undefined;
  if (!b || typeof b.id !== "string" || !UUID.test(b.id)) return undefined;
  const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 1_000;
  return ok(b.part) && ok(b.parts) && b.part <= b.parts ? { id: b.id, part: b.part, parts: b.parts } : undefined;
}

/**
 * BL-FB-X-CRM Slice 3 — write the previewed rows; duplicates skipped or
 * updated. Audited. BL-STAB-2f — a large import arrives in parts (one
 * call each, each audited with the import's id and its part number).
 */
export async function commitContactImportAction(input: { rows: Partial<ImportRow>[]; duplicates: "skip" | "update"; batch?: ImportBatch }): Promise<ImportCommit> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await commitContactImport({
    organizationId,
    rows: Array.isArray(input.rows) ? input.rows : [],
    duplicates: input.duplicates === "update" ? "update" : "skip",
    actor: { userId: actor.id, email: actor.email },
    batch: importBatch(input.batch),
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
