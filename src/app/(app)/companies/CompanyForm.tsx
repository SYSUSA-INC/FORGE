"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CompanyRelationship } from "@/db/schema";
import { RELATIONSHIPS } from "@/lib/company-types";
import {
  createCompanyAction,
  updateCompanyAction,
  type CompanyInput,
} from "./actions";

export function CompanyForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: CompanyInput;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [uei, setUei] = useState(initial?.uei ?? "");
  const [cageCode, setCageCode] = useState(initial?.cageCode ?? "");
  const [dunsNumber, setDunsNumber] = useState(initial?.dunsNumber ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [contactTitle, setContactTitle] = useState(initial?.contactTitle ?? "");
  const [addressLine1, setAddressLine1] = useState(initial?.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(initial?.addressLine2 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [stateVal, setStateVal] = useState(initial?.state ?? "");
  const [zip, setZip] = useState(initial?.zip ?? "");
  const [country, setCountry] = useState(initial?.country ?? "USA");
  const [primaryNaics, setPrimaryNaics] = useState(initial?.primaryNaics ?? "");
  const [relationship, setRelationship] = useState<CompanyRelationship>(
    (initial?.relationship as CompanyRelationship) ?? "watchlist",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  function collect(): CompanyInput {
    return {
      name,
      uei,
      cageCode,
      dunsNumber,
      website,
      email,
      phone,
      contactName,
      contactTitle,
      addressLine1,
      addressLine2,
      city,
      state: stateVal,
      zip,
      country,
      primaryNaics,
      relationship,
      notes,
    };
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      if (mode === "create") {
        const res = await createCompanyAction(collect());
        if (!res.ok) return setError(res.error);
        router.push(`/companies/${res.id}`);
      } else if (mode === "edit" && id) {
        const res = await updateCompanyAction(id, collect());
        if (!res.ok) return setError(res.error);
        setNotice("Saved.");
        router.refresh();
      }
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <Field label="Company name" required>
        <input
          className="aur-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Relationship">
          <select
            className="aur-input"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as CompanyRelationship)}
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label} — {r.description}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Website">
          <input
            className="aur-input"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="UEI">
          <input
            className="aur-input"
            value={uei}
            onChange={(e) => setUei(e.target.value.toUpperCase())}
            placeholder="12-char"
          />
        </Field>
        <Field label="CAGE">
          <input
            className="aur-input"
            value={cageCode}
            onChange={(e) => setCageCode(e.target.value.toUpperCase())}
            placeholder="5 chars"
          />
        </Field>
        <Field label="DUNS">
          <input
            className="aur-input"
            value={dunsNumber}
            onChange={(e) => setDunsNumber(e.target.value)}
            placeholder="9 digits"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Primary NAICS">
          <input
            className="aur-input"
            value={primaryNaics}
            onChange={(e) => setPrimaryNaics(e.target.value)}
            placeholder="541512"
          />
        </Field>
        <Field label="Phone">
          <input
            className="aur-input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(202) 555-0100"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Contact name">
          <input
            className="aur-input"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </Field>
        <Field label="Contact title">
          <input
            className="aur-input"
            value={contactTitle}
            onChange={(e) => setContactTitle(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Email">
        <input
          className="aur-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <div className="md:col-span-3">
          <Field label="Address line 1">
            <input
              className="aur-input"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
            />
          </Field>
        </div>
        <div className="md:col-span-3">
          <Field label="Address line 2">
            <input
              className="aur-input"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="City">
            <input
              className="aur-input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
        </div>
        <Field label="State">
          <input
            className="aur-input"
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="ZIP">
          <input
            className="aur-input"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Country">
            <input
              className="aur-input"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <Field label="Notes">
        <textarea
          className="aur-input min-h-[100px] resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Relationship context, key people, past work together…"
        />
      </Field>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Create company"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col">
      <span className="aur-label">
        {label}
        {required ? <span className="ml-1 text-rose">*</span> : null}
      </span>
      {children}
    </label>
  );
}
