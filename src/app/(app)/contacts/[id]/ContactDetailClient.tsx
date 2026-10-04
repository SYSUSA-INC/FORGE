"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CONTACT_LIMITS, CONTACT_ROLE_LABELS, TOUCH_KINDS, TOUCH_KIND_LABELS, describeRecency, normalizeRole, normalizeTouchKind, warmthScore } from "@/lib/crm-logic";
import { deleteContactAction, logTouchAction } from "../actions";
import { AgencyHistoryPanel } from "../AgencyHistoryPanel";
import { ContactForm, type OwnerOption } from "../ContactForm";
import { NextTouchBadge } from "../ContactsClient";
import { WarmthChip } from "../WarmthChip";

type Contact = {
  id: string;
  agency: string;
  office: string;
  name: string;
  title: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  ownerUserId: string | null;
  lastTouchAt: string | null;
  nextTouchAt: string | null;
  touchCount: number;
};
type Touch = { id: string; kind: string; occurredAt: string; summary: string; nextTouchAt: string | null; opportunityId: string | null; opportunityTitle: string | null; loggedBy: string | null };
type Opp = { id: string; title: string; agency: string };

export function ContactDetailClient({ contact, touches, owners, opportunities }: { contact: Contact; touches: Touch[]; owners: OwnerOption[]; opportunities: Opp[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("meeting");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [nextTouchAt, setNextTouchAt] = useState("");
  const role = normalizeRole(contact.role);
  const warmth = warmthScore({ lastTouchAt: contact.lastTouchAt, touchCount: contact.touchCount, role });

  function log(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await logTouchAction({ contactId: contact.id, kind, occurredAt: occurredAt ? `${occurredAt}T12:00:00` : null, summary, opportunityId: opportunityId || null, nextTouchAt: nextTouchAt || null });
      if (!res.ok) return setError(res.error);
      setSummary("");
      setNextTouchAt("");
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete ${contact.name} and the touch history?`)) return;
    startTransition(async () => {
      const res = await deleteContactAction(contact.id);
      if (!res.ok) return setError(res.error);
      router.push("/contacts");
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Customer contact"
        title={contact.name}
        subtitle={[contact.title, contact.agency, contact.office].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link href="/contacts" className="aur-btn aur-btn-ghost">
              ← All contacts
            </Link>
            <button type="button" onClick={remove} disabled={pending} className="aur-btn aur-btn-ghost text-rose-300">
              Delete
            </button>
          </>
        }
        meta={[
          { label: "Warmth", value: String(warmth), accent: warmth >= 70 ? "rose" : warmth >= 40 ? "gold" : undefined },
          { label: "Last touch", value: describeRecency(contact.lastTouchAt) },
          { label: "Touches", value: String(contact.touchCount) },
          { label: "Role", value: CONTACT_ROLE_LABELS[role] },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <Panel title="Log a touch" eyebrow="Meeting, call, email, event or note" actions={<NextTouchBadge nextTouchAt={contact.nextTouchAt} />}>
            <form onSubmit={log} className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <select className="aur-input w-auto text-[12px]" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {TOUCH_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input className="aur-input w-auto text-[12px]" type="date" value={occurredAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setOccurredAt(e.target.value)} />
                <select className="aur-input min-w-[200px] flex-1 text-[12px]" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
                  <option value="">No opportunity</option>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                      {o.agency ? ` · ${o.agency}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <textarea className="aur-input text-[12px]" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={CONTACT_LIMITS.summary} placeholder="What was said, what they need, what we promised." />
              <div className="flex flex-wrap items-center gap-2">
                <label className="aur-label mb-0">Next touch</label>
                <input className="aur-input w-auto text-[12px]" type="date" value={nextTouchAt} onChange={(e) => setNextTouchAt(e.target.value)} />
                <button type="submit" disabled={pending || !summary.trim()} className="aur-btn aur-btn-primary ml-auto text-[12px] disabled:opacity-60">
                  {pending ? "Logging…" : "Log touch"}
                </button>
              </div>
              {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
            </form>
          </Panel>
          <Panel title="History" eyebrow={`${touches.length} touch${touches.length === 1 ? "" : "es"}`} dense>
            {touches.length === 0 ? (
              <p className="px-4 py-3 font-body text-[12px] text-muted">Nothing logged yet. The first touch sets the last-contact date and starts the warmth score.</p>
            ) : (
              <ul className="divide-y divide-layer/5">
                {touches.map((t) => (
                  <li key={t.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
                      <span className="rounded bg-layer/5 px-1.5 py-0.5 text-[9px] uppercase tracking-widest">{TOUCH_KIND_LABELS[normalizeTouchKind(t.kind)]}</span>
                      <span>{new Date(t.occurredAt).toLocaleDateString()}</span>
                      {t.loggedBy ? <span>by {t.loggedBy}</span> : null}
                      {t.opportunityId ? (
                        <Link href={`/opportunities/${t.opportunityId}`} className="text-indigo-300 hover:underline">
                          {t.opportunityTitle ?? "opportunity"}
                        </Link>
                      ) : null}
                      {t.nextTouchAt ? <span>→ next {new Date(t.nextTouchAt).toLocaleDateString()}</span> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-text">{t.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-4">
          <Panel title="Details" eyebrow="Edit the contact" actions={<WarmthChip score={warmth} />}>
            <ContactForm
              contactId={contact.id}
              owners={owners}
              submitLabel="Save changes"
              onSaved={() => router.refresh()}
              initial={{
                agency: contact.agency,
                office: contact.office,
                name: contact.name,
                title: contact.title,
                role,
                email: contact.email,
                phone: contact.phone,
                ownerUserId: contact.ownerUserId ?? "",
                nextTouchAt: contact.nextTouchAt ? contact.nextTouchAt.slice(0, 10) : "",
                notes: contact.notes,
              }}
            />
          </Panel>
          {/* Slice 2 — what this customer has been buying, from USAspending, on demand. */}
          <Panel title="Procurement history" eyebrow="Recent awards by this agency">
            <AgencyHistoryPanel agency={contact.agency} />
          </Panel>
        </div>
      </div>
    </>
  );
}
