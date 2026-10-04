import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { contactsForAgencyName, type OpportunityContact } from "@/lib/crm";
import { CONTACT_ROLE_LABELS, describeRecency, nextTouchStatus, normalizeRole } from "@/lib/crm-logic";
import { WarmthChip } from "@/app/(app)/contacts/WarmthChip";

const SHOW = 5;

/**
 * BL-FB-X-CRM — "who do we know here": the contacts at an agency, warmest
 * first, wherever a pursuit names a customer (opportunity overview,
 * solicitation intake). Server component; renders nothing without an
 * agency. Callers own auth and pass the current organization.
 */
export async function AgencyContactsPanel({ organizationId, agency, className }: { organizationId: string; agency: string; className?: string }) {
  if (!agency.trim()) return null;
  const contacts = await contactsForAgencyName({ organizationId, agency });
  return <AgencyContactsView agency={agency} contacts={contacts} className={className} />;
}

/** The panel itself, for callers that already resolved the agency's contacts. */
export function AgencyContactsView({ agency, contacts, className }: { agency: string; contacts: OpportunityContact[]; className?: string }) {
  const addHref = `/contacts?add=${encodeURIComponent(agency)}`;
  return (
    <Panel
      title={`Who we know at ${agency}`}
      eyebrow={contacts.length === 0 ? "No contacts yet" : `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`}
      className={className}
      actions={
        <Link href={contacts.length === 0 ? addHref : "/contacts"} className="aur-btn aur-btn-ghost text-[11px]">
          {contacts.length === 0 ? "+ Add" : "All contacts"}
        </Link>
      }
    >
      {contacts.length === 0 ? (
        <p className="font-body text-[12px] text-muted">
          Nobody from this agency is in the contacts yet. A warm name here is worth more than a page of boilerplate: <Link href={addHref} className="text-indigo-300 hover:underline">add the people you know</Link>.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {contacts.slice(0, SHOW).map((c) => {
            const next = nextTouchStatus(c.nextTouchAt);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-1.5">
                <div className="min-w-0">
                  <Link href={`/contacts/${c.id}`} className="font-body text-[12px] font-semibold text-text hover:underline">
                    {c.name}
                  </Link>
                  <div className="font-mono text-[10px] text-muted">
                    {CONTACT_ROLE_LABELS[normalizeRole(c.role)]}
                    {c.title ? ` · ${c.title}` : ""} · {describeRecency(c.lastTouchAt).toLowerCase()}
                    {c.ownerName ? ` · owner ${c.ownerName}` : ""}
                    {next.state === "overdue" ? <span className="ml-1 text-rose-300">· follow-up overdue</span> : next.state === "due_soon" ? <span className="ml-1 text-amber-200">· follow-up due</span> : null}
                  </div>
                </div>
                <WarmthChip score={c.warmth} />
              </li>
            );
          })}
          {contacts.length > SHOW ? <li className="font-mono text-[10px] text-subtle">+{contacts.length - SHOW} more on the contacts page</li> : null}
        </ul>
      )}
    </Panel>
  );
}
