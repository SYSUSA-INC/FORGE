import { notFound } from "next/navigation";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getContact } from "@/lib/crm";
import { listContactOwners, listTouchOpportunities } from "../actions";
import { ContactDetailClient } from "./ContactDetailClient";

export const dynamic = "force-dynamic";

/** BL-FB-X-CRM — one contact: the relationship, its history, and the next step. */
export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const data = await getContact({ organizationId, contactId: params.id });
  if (!data) notFound();
  const [owners, opportunities] = await Promise.all([listContactOwners(), listTouchOpportunities()]);
  const c = data.contact;
  return (
    <ContactDetailClient
      owners={owners}
      opportunities={opportunities}
      contact={{
        id: c.id,
        agency: c.agency,
        office: c.office,
        name: c.name,
        title: c.title,
        role: c.role,
        email: c.email,
        phone: c.phone,
        notes: c.notes,
        ownerUserId: c.ownerUserId,
        lastTouchAt: c.lastTouchAt ? c.lastTouchAt.toISOString() : null,
        nextTouchAt: c.nextTouchAt ? c.nextTouchAt.toISOString() : null,
        touchCount: c.touchCount,
      }}
      touches={data.touches.map((t) => ({
        id: t.id,
        kind: t.kind,
        occurredAt: t.occurredAt.toISOString(),
        summary: t.summary,
        nextTouchAt: t.nextTouchAt ? t.nextTouchAt.toISOString() : null,
        opportunityId: t.opportunityId,
        opportunityTitle: t.opportunityTitle,
        loggedBy: t.loggedByName ?? t.loggedByEmail ?? null,
      }))}
    />
  );
}
