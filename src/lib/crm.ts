/**
 * BL-FB-X-CRM — customer contacts against Postgres: tenant-scoped
 * create / update / delete, the touch log that drives last- and
 * next-touch, and the match from an opportunity's agency to the people
 * we know there. Server-only; callers own auth; every mutation audited.
 */
import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerContacts, customerTouches, memberships, opportunities, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  CONTACT_LIMITS,
  agencyKey,
  contactsForAgency,
  normalizeRole,
  normalizeTouchKind,
  warmthScore,
  type ContactRole,
} from "@/lib/crm-logic";

type Actor = { userId: string | null; email?: string | null };

export type ContactInput = {
  agency: string;
  office?: string;
  name: string;
  title?: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
  ownerUserId?: string | null;
  /** ISO date; null clears. */
  nextTouchAt?: string | null;
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const toDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function isMember(organizationId: string, userId: string) {
  const [row] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId), eq(memberships.status, "active")))
    .limit(1);
  return !!row;
}

export async function listContacts(input: { organizationId: string }) {
  const { organizationId } = input;
  return db
    .select({
      id: customerContacts.id,
      agency: customerContacts.agency,
      agencyKey: customerContacts.agencyKey,
      office: customerContacts.office,
      name: customerContacts.name,
      title: customerContacts.title,
      role: customerContacts.role,
      email: customerContacts.email,
      phone: customerContacts.phone,
      ownerUserId: customerContacts.ownerUserId,
      ownerName: users.name,
      lastTouchAt: customerContacts.lastTouchAt,
      nextTouchAt: customerContacts.nextTouchAt,
      touchCount: customerContacts.touchCount,
    })
    .from(customerContacts)
    .leftJoin(users, eq(users.id, customerContacts.ownerUserId))
    .where(eq(customerContacts.organizationId, organizationId))
    .orderBy(asc(customerContacts.agency), asc(customerContacts.name));
}

export async function getContact(input: { organizationId: string; contactId: string }) {
  const { organizationId } = input;
  const [contact] = await db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.id, input.contactId), eq(customerContacts.organizationId, organizationId)))
    .limit(1);
  if (!contact) return null;
  const touches = await db
    .select({
      id: customerTouches.id,
      kind: customerTouches.kind,
      occurredAt: customerTouches.occurredAt,
      summary: customerTouches.summary,
      nextTouchAt: customerTouches.nextTouchAt,
      opportunityId: customerTouches.opportunityId,
      opportunityTitle: opportunities.title,
      loggedByName: users.name,
      loggedByEmail: users.email,
    })
    .from(customerTouches)
    .leftJoin(opportunities, eq(opportunities.id, customerTouches.opportunityId))
    .leftJoin(users, eq(users.id, customerTouches.loggedByUserId))
    .where(and(eq(customerTouches.organizationId, organizationId), eq(customerTouches.contactId, contact.id)))
    .orderBy(desc(customerTouches.occurredAt), desc(customerTouches.createdAt));
  return { contact, touches };
}

export type SaveContactResult = { ok: true; id: string } | { ok: false; error: string };

/** Create (no `contactId`) or update one contact of the organization; the owner must be a member. */
export async function saveContact(input: { organizationId: string; contactId?: string | null; input: ContactInput; actor: Actor }): Promise<SaveContactResult> {
  const { organizationId } = input;
  const name = clip(input.input.name, CONTACT_LIMITS.name);
  const agency = clip(input.input.agency, CONTACT_LIMITS.agency);
  if (!name) return { ok: false, error: "Name is required." };
  if (!agency) return { ok: false, error: "Agency is required." };
  const ownerUserId = input.input.ownerUserId || null;
  if (ownerUserId && !(await isMember(organizationId, ownerUserId))) return { ok: false, error: "The owner must be a member of this organization." };

  const values = {
    agency,
    agencyKey: agencyKey(agency),
    office: clip(input.input.office, CONTACT_LIMITS.office),
    name,
    title: clip(input.input.title, CONTACT_LIMITS.title),
    role: normalizeRole(input.input.role) as ContactRole,
    email: clip(input.input.email, CONTACT_LIMITS.email).toLowerCase(),
    phone: clip(input.input.phone, CONTACT_LIMITS.phone),
    notes: clip(input.input.notes, CONTACT_LIMITS.notes),
    ownerUserId,
    nextTouchAt: input.input.nextTouchAt === undefined ? undefined : toDate(input.input.nextTouchAt),
    updatedAt: new Date(),
  };

  if (input.contactId) {
    const [row] = await db
      .update(customerContacts)
      .set(values)
      .where(and(eq(customerContacts.id, input.contactId), eq(customerContacts.organizationId, organizationId)))
      .returning({ id: customerContacts.id });
    if (!row) return { ok: false, error: "Contact not found." };
    await recordAudit({ organizationId, actor: input.actor, action: "crm.contact.update", resourceType: "customer_contact", resourceId: row.id, metadata: { agency, role: values.role } });
    return { ok: true, id: row.id };
  }
  const [row] = await db
    .insert(customerContacts)
    .values({ ...values, nextTouchAt: values.nextTouchAt ?? null, organizationId, createdByUserId: input.actor.userId })
    .returning({ id: customerContacts.id });
  if (!row) return { ok: false, error: "Could not create the contact." };
  await recordAudit({ organizationId, actor: input.actor, action: "crm.contact.create", resourceType: "customer_contact", resourceId: row.id, metadata: { agency, role: values.role } });
  return { ok: true, id: row.id };
}

export async function deleteContact(input: { organizationId: string; contactId: string; actor: Actor }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [row] = await db
    .delete(customerContacts)
    .where(and(eq(customerContacts.id, input.contactId), eq(customerContacts.organizationId, organizationId)))
    .returning({ id: customerContacts.id, agency: customerContacts.agency });
  if (!row) return { ok: false, error: "Contact not found." };
  await recordAudit({ organizationId, actor: input.actor, action: "crm.contact.delete", resourceType: "customer_contact", resourceId: row.id, metadata: { agency: row.agency } });
  return { ok: true };
}

export type TouchInput = {
  kind?: string;
  /** ISO date-time; now when omitted. */
  occurredAt?: string | null;
  summary: string;
  opportunityId?: string | null;
  /** ISO date; the follow-up agreed in this touch. */
  nextTouchAt?: string | null;
};

/** Log an interaction and roll its dates up onto the contact; audited. */
export async function logTouch(input: { organizationId: string; contactId: string; input: TouchInput; actor: Actor }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [contact] = await db
    .select({ id: customerContacts.id, lastTouchAt: customerContacts.lastTouchAt, nextTouchAt: customerContacts.nextTouchAt, touchCount: customerContacts.touchCount })
    .from(customerContacts)
    .where(and(eq(customerContacts.id, input.contactId), eq(customerContacts.organizationId, organizationId)))
    .limit(1);
  if (!contact) return { ok: false, error: "Contact not found." };
  const summary = clip(input.input.summary, CONTACT_LIMITS.summary);
  if (!summary) return { ok: false, error: "Say what happened." };
  const occurredAt = toDate(input.input.occurredAt) ?? new Date();
  if (occurredAt.getTime() > Date.now() + 60_000) return { ok: false, error: "A touch cannot be in the future — set a next touch instead." };

  let opportunityId: string | null = null;
  if (input.input.opportunityId) {
    const [opp] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.id, input.input.opportunityId), eq(opportunities.organizationId, organizationId)))
      .limit(1);
    if (!opp) return { ok: false, error: "Opportunity not found." };
    opportunityId = opp.id;
  }
  const nextTouchAt = toDate(input.input.nextTouchAt);

  const [row] = await db
    .insert(customerTouches)
    .values({ organizationId, contactId: contact.id, kind: normalizeTouchKind(input.input.kind), occurredAt, summary, opportunityId, nextTouchAt, loggedByUserId: input.actor.userId })
    .returning({ id: customerTouches.id });
  if (!row) return { ok: false, error: "Could not log the touch." };

  const lastTouchAt = contact.lastTouchAt && contact.lastTouchAt > occurredAt ? contact.lastTouchAt : occurredAt;
  // A new follow-up replaces the old one; a touch on or after the agreed date clears it.
  const carriedNext = contact.nextTouchAt && contact.nextTouchAt > occurredAt ? contact.nextTouchAt : null;
  await db
    .update(customerContacts)
    .set({ lastTouchAt, nextTouchAt: nextTouchAt ?? carriedNext, touchCount: contact.touchCount + 1, updatedAt: new Date() })
    .where(and(eq(customerContacts.id, contact.id), eq(customerContacts.organizationId, organizationId)));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "crm.touch.log",
    resourceType: "customer_contact",
    resourceId: contact.id,
    metadata: { touchId: row.id, kind: normalizeTouchKind(input.input.kind), opportunityId, hasNextTouch: !!nextTouchAt },
  });
  return { ok: true, id: row.id };
}

export type OpportunityContact = Awaited<ReturnType<typeof listContacts>>[number] & { warmth: number };

/** The people we know at an opportunity's agency, warmest first; empty when the agency is blank or unknown. */
export async function contactsForOpportunity(input: { organizationId: string; opportunityId: string }): Promise<{ agency: string; contacts: OpportunityContact[] }> {
  const { organizationId } = input;
  const [opp] = await db
    .select({ agency: opportunities.agency })
    .from(opportunities)
    .where(and(eq(opportunities.id, input.opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp || !opp.agency.trim()) return { agency: opp?.agency ?? "", contacts: [] };
  const all = await listContacts({ organizationId });
  const matched = contactsForAgency(
    all.map((c) => ({ ...c, role: normalizeRole(c.role) })),
    opp.agency,
  );
  return { agency: opp.agency, contacts: matched.map((c) => ({ ...c, warmth: warmthScore({ lastTouchAt: c.lastTouchAt, touchCount: c.touchCount, role: c.role }) })) };
}
