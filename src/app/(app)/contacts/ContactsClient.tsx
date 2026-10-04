"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CONTACT_ROLES, CONTACT_ROLE_LABELS, agencyRollups, contactCsvRow, describeRecency, nextTouchStatus, normalizeRole, warmthScore } from "@/lib/crm-logic";
import { downloadCsv } from "@/lib/csv-export";
import { recordContactExportAction } from "./actions";
import { AgencyHistoryPanel } from "./AgencyHistoryPanel";
import { ContactForm, type OwnerOption } from "./ContactForm";
import { ContactsImportPanel } from "./ContactsImportPanel";
import { WarmthChip } from "./WarmthChip";

export type ContactRow = {
  id: string;
  agency: string;
  agencyKey: string;
  office: string;
  name: string;
  title: string;
  role: string;
  email: string;
  phone: string;
  ownerUserId: string | null;
  ownerName: string | null;
  lastTouchAt: string | null;
  nextTouchAt: string | null;
  touchCount: number;
};

export function NextTouchBadge({ nextTouchAt }: { nextTouchAt: string | null }) {
  const s = nextTouchStatus(nextTouchAt);
  if (s.state === "none") return <span className="font-mono text-[10px] text-subtle">no follow-up set</span>;
  const date = new Date(nextTouchAt!).toLocaleDateString();
  if (s.state === "overdue") return <span className="rounded border border-rose/40 bg-rose/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-rose">overdue · {date}</span>;
  if (s.state === "due_soon") return <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-200">due {date}</span>;
  return <span className="font-mono text-[10px] text-muted">next {date}</span>;
}

/** BL-FB-X-CRM — contacts grouped by agency, warmest agency first, follow-ups owed up top. */
export function ContactsClient({
  contacts,
  owners,
  prefillAgency,
  initialAdding = false,
  initialOwed = false,
  initialImporting = false,
}: {
  contacts: ContactRow[];
  owners: OwnerOption[];
  prefillAgency: string;
  /** Slice 3 — the Customer Relations menu deep-links into the page. */
  initialAdding?: boolean;
  initialOwed?: boolean;
  initialImporting?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [owed, setOwed] = useState(initialOwed);
  const [adding, setAdding] = useState(!!prefillAgency || initialAdding);
  // Slice 3 — the import panel and what it just did.
  const [importing, setImporting] = useState(initialImporting);
  const [notice, setNotice] = useState<string | null>(null);

  const typed = useMemo(() => contacts.map((c) => ({ ...c, role: normalizeRole(c.role) })), [contacts]);
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    return typed.filter((c) => {
      if (role !== "all" && c.role !== role) return false;
      if (owed && !["overdue", "due_soon"].includes(nextTouchStatus(c.nextTouchAt).state)) return false;
      if (!f) return true;
      return [c.name, c.title, c.agency, c.office, c.email, c.ownerName ?? ""].some((s) => s.toLowerCase().includes(f));
    });
  }, [typed, q, role, owed]);
  const rollups = useMemo(() => agencyRollups(filtered), [filtered]);
  const all = useMemo(() => agencyRollups(typed), [typed]);
  const overdue = all.reduce((n, r) => n + r.overdue, 0);
  const dueSoon = all.reduce((n, r) => n + r.dueSoon, 0);

  // Slice 4 — the list as filtered on screen, as CSV; the export is recorded first.
  async function exportList() {
    const rows = filtered.map((c) => contactCsvRow(c));
    if (rows.length === 0) return;
    await recordContactExportAction({ count: rows.length, filtered: rows.length !== contacts.length });
    const headers = Object.keys(rows[0]!);
    downloadCsv(
      `contacts-${new Date().toISOString().slice(0, 10)}.csv`,
      rows,
      headers.map((h) => ({ header: h, get: (r: Record<string, string | number>) => r[h] })),
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Customer Relations"
        title="Customer contacts"
        subtitle="Who we know at each agency, how warm the relationship is, and who we owe a call. Log every meeting so the next pursuit starts from a name, not a cold notice."
        actions={
          <>
            <button
              type="button"
              onClick={exportList}
              disabled={filtered.length === 0}
              className="aur-btn aur-btn-ghost disabled:opacity-50"
              title="Download the contacts shown below as a CSV file"
            >
              Download CSV
            </button>
            <button type="button" onClick={() => setImporting((v) => !v)} className="aur-btn aur-btn-ghost" title="Import contacts from a CSV or a vCard export">
              {importing ? "Close import" : "Import"}
            </button>
            <button type="button" onClick={() => setAdding((v) => !v)} className="aur-btn aur-btn-primary">
              {adding ? "Close" : "+ Add contact"}
            </button>
          </>
        }
        meta={[
          { label: "Contacts", value: String(contacts.length) },
          { label: "Agencies", value: String(all.length) },
          { label: "Overdue follow-ups", value: String(overdue), accent: overdue ? "rose" : undefined },
          { label: "Due this week", value: String(dueSoon), accent: dueSoon ? "gold" : undefined },
        ]}
      />

      {notice ? <div className="mb-3 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">{notice}</div> : null}
      {importing ? (
        <Panel title="Import contacts" eyebrow="CSV or vCard" className="mb-4">
          <ContactsImportPanel
            onDone={(msg) => {
              setImporting(false);
              setNotice(msg);
              router.refresh();
            }}
          />
        </Panel>
      ) : null}
      {adding ? (
        <Panel title="New contact" eyebrow="Customer relationship" className="mb-4">
          <ContactForm owners={owners} initial={{ agency: prefillAgency }} submitLabel="Add contact" onSaved={() => router.refresh()} />
        </Panel>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="aur-input max-w-xs text-[12px]" placeholder="Search name, agency, office, owner…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="aur-input w-auto text-[12px]" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="all">All roles</option>
          {CONTACT_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1 font-mono text-[11px] text-muted">
          <input type="checkbox" className="accent-teal-400" checked={owed} onChange={(e) => setOwed(e.target.checked)} />
          Follow-up owed
        </label>
        <span className="ml-auto font-mono text-[10px] text-subtle">{filtered.length} shown</span>
      </div>

      {contacts.length === 0 ? (
        <Panel title="No contacts yet">
          <p className="text-sm text-muted">Add the contracting officers, CORs and program managers you already know. Each opportunity then shows who we know at that agency before anyone starts writing.</p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {rollups.map((r) => (
            <Panel
              key={r.agencyKey}
              title={r.agency}
              eyebrow={`${r.contacts} contact${r.contacts === 1 ? "" : "s"} · last touch ${describeRecency(r.lastTouchAt).toLowerCase()}${r.overdue ? ` · ${r.overdue} overdue` : ""}`}
              actions={<WarmthChip score={r.warmest} />}
              dense
            >
              <ul className="divide-y divide-layer/5">
                {filtered
                  .filter((c) => (c.agencyKey || "unassigned") === r.agencyKey)
                  .map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <Link href={`/contacts/${c.id}`} className="font-body text-[13px] font-semibold text-text hover:underline">
                          {c.name}
                        </Link>
                        <span className="ml-2 font-mono text-[10px] text-muted">
                          {[c.title, c.office].filter(Boolean).join(" · ")}
                        </span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
                          <span className="rounded bg-layer/5 px-1.5 py-0.5 text-[9px] uppercase tracking-widest">{CONTACT_ROLE_LABELS[c.role]}</span>
                          <span>{describeRecency(c.lastTouchAt)}</span>
                          <NextTouchBadge nextTouchAt={c.nextTouchAt} />
                          {c.ownerName ? <span>owner {c.ownerName}</span> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <WarmthChip score={warmthScore({ lastTouchAt: c.lastTouchAt, touchCount: c.touchCount, role: c.role })} />
                        <Link href={`/contacts/${c.id}`} className="aur-btn aur-btn-ghost text-[11px]">
                          Open
                        </Link>
                      </div>
                    </li>
                  ))}
              </ul>
              {/* Slice 2 — what the agency has been buying, loaded on demand. */}
              {r.agencyKey !== "unassigned" ? <AgencyHistoryPanel agency={r.agency} compact /> : null}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
