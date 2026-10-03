"use client";

import { FormEvent, useState, useTransition } from "react";
import { CONTACT_LIMITS, CONTACT_ROLES } from "@/lib/crm-logic";
import { saveContactAction } from "./actions";

export type OwnerOption = { id: string; name: string | null; email: string };

export type ContactFormValues = {
  agency: string;
  office: string;
  name: string;
  title: string;
  role: string;
  email: string;
  phone: string;
  ownerUserId: string;
  /** YYYY-MM-DD or "". */
  nextTouchAt: string;
  notes: string;
};

const EMPTY: ContactFormValues = { agency: "", office: "", name: "", title: "", role: "other", email: "", phone: "", ownerUserId: "", nextTouchAt: "", notes: "" };

/** BL-FB-X-CRM — one form for adding and editing a customer contact. */
export function ContactForm({
  initial,
  contactId,
  owners,
  onSaved,
  submitLabel,
}: {
  initial?: Partial<ContactFormValues>;
  contactId?: string;
  owners: OwnerOption[];
  onSaved: (id: string) => void;
  submitLabel: string;
}) {
  const [v, setV] = useState<ContactFormValues>({ ...EMPTY, ...initial });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ContactFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveContactAction({ ...v, contactId: contactId ?? null, ownerUserId: v.ownerUserId || null, nextTouchAt: v.nextTouchAt || null });
      if (!res.ok) return setError(res.error);
      if (!contactId) setV({ ...EMPTY, agency: v.agency });
      onSaved(res.id);
    });
  }

  const field = (label: string, el: React.ReactNode, span = false) => (
    <div className={span ? "sm:col-span-2" : ""}>
      <label className="aur-label">{label}</label>
      {el}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {field("Agency", <input className="aur-input" value={v.agency} onChange={set("agency")} maxLength={CONTACT_LIMITS.agency} placeholder="Department of the Navy" required />)}
      {field("Office / command", <input className="aur-input" value={v.office} onChange={set("office")} maxLength={CONTACT_LIMITS.office} placeholder="NAVSEA PEO IWS" />)}
      {field("Name", <input className="aur-input" value={v.name} onChange={set("name")} maxLength={CONTACT_LIMITS.name} required />)}
      {field("Title", <input className="aur-input" value={v.title} onChange={set("title")} maxLength={CONTACT_LIMITS.title} />)}
      {field(
        "Role",
        <select className="aur-input" value={v.role} onChange={set("role")}>
          {CONTACT_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>,
      )}
      {field(
        "Relationship owner (our side)",
        <select className="aur-input" value={v.ownerUserId} onChange={set("ownerUserId")}>
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name ?? o.email}
            </option>
          ))}
        </select>,
      )}
      {field("Email", <input className="aur-input" type="email" value={v.email} onChange={set("email")} maxLength={CONTACT_LIMITS.email} />)}
      {field("Phone", <input className="aur-input" value={v.phone} onChange={set("phone")} maxLength={CONTACT_LIMITS.phone} />)}
      {field("Next touch (optional)", <input className="aur-input" type="date" value={v.nextTouchAt} onChange={set("nextTouchAt")} />)}
      {field("Notes", <textarea className="aur-input text-[12px]" rows={3} value={v.notes} onChange={set("notes")} maxLength={CONTACT_LIMITS.notes} placeholder="How we know them, what they care about, who introduced us." />, true)}
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose sm:col-span-2">{error}</div> : null}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending || !v.name.trim() || !v.agency.trim()} className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60">
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
