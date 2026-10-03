import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listContacts } from "@/lib/crm";
import { listContactOwners } from "./actions";
import { ContactsClient } from "./ContactsClient";

export const dynamic = "force-dynamic";

/** BL-FB-X-CRM — who we know at each customer, and who we owe a call. */
export default async function ContactsPage({ searchParams }: { searchParams?: { add?: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [contacts, owners] = await Promise.all([listContacts({ organizationId }), listContactOwners()]);
  return (
    <ContactsClient
      owners={owners}
      prefillAgency={typeof searchParams?.add === "string" ? searchParams.add.slice(0, 160) : ""}
      contacts={contacts.map((c) => ({
        ...c,
        lastTouchAt: c.lastTouchAt ? c.lastTouchAt.toISOString() : null,
        nextTouchAt: c.nextTouchAt ? c.nextTouchAt.toISOString() : null,
      }))}
    />
  );
}
