import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listContacts } from "@/lib/crm";
import { listContactOwners } from "./actions";
import { ContactsClient } from "./ContactsClient";

export const dynamic = "force-dynamic";

/**
 * BL-FB-X-CRM — who we know at each customer, and who we owe a call.
 * The Customer Relations menu deep-links here: `?owed=1` filters to the
 * follow-ups owed, `?add=1` (or `?add=<agency>`) opens the new-contact
 * form, `?import=1` opens the import panel.
 */
export default async function ContactsPage({ searchParams }: { searchParams?: { add?: string; owed?: string; import?: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [contacts, owners] = await Promise.all([listContacts({ organizationId }), listContactOwners()]);
  const add = typeof searchParams?.add === "string" ? searchParams.add : undefined;
  return (
    <ContactsClient
      owners={owners}
      prefillAgency={add && add !== "1" ? add.slice(0, 160) : ""}
      initialAdding={add !== undefined}
      initialOwed={searchParams?.owed === "1"}
      initialImporting={searchParams?.import === "1"}
      contacts={contacts.map((c) => ({
        ...c,
        lastTouchAt: c.lastTouchAt ? c.lastTouchAt.toISOString() : null,
        nextTouchAt: c.nextTouchAt ? c.nextTouchAt.toISOString() : null,
      }))}
    />
  );
}
