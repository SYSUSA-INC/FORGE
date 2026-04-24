"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CompanyRelationship } from "@/db/schema";
import { RELATIONSHIPS } from "@/lib/company-types";
import {
  importSamGovCompanyAction,
  searchSamGovCompaniesAction,
  type ImportableSamEntity,
} from "../actions";

export function SearchClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [uei, setUei] = useState("");
  const [cage, setCage] = useState("");
  const [naics, setNaics] = useState("");
  const [state, setState] = useState("");
  const [defaultRel, setDefaultRel] =
    useState<CompanyRelationship>("watchlist");
  const [results, setResults] = useState<ImportableSamEntity[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, startLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  function search() {
    setError(null);
    setNotice(null);
    setResults(null);
    startLoading(async () => {
      const res = await searchSamGovCompaniesAction({
        name: name.trim() || undefined,
        uei: uei.trim() || undefined,
        cage: cage.trim() || undefined,
        naics: naics.trim() || undefined,
        state: state.trim() || undefined,
      });
      if (!res.ok) return setError(res.error);
      setResults(res.entities);
      setTotal(res.totalRecords);
    });
  }

  async function importOne(uei: string) {
    setError(null);
    setNotice(null);
    setImportingId(uei);
    const res = await importSamGovCompanyAction(uei, defaultRel);
    setImportingId(null);
    if (!res.ok) return setError(res.error);
    setNotice("Imported. You can tag or edit it on the Companies list.");
    setResults((prev) =>
      prev
        ? prev.map((e) =>
            e.ueiSAM === uei ? { ...e, alreadyImported: true } : e,
          )
        : prev,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Field label="Company name">
          <input
            className="aur-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Booz Allen"
          />
        </Field>
        <Field label="UEI">
          <input
            className="aur-input"
            value={uei}
            onChange={(e) => setUei(e.target.value.toUpperCase())}
            placeholder="12-char UEI"
          />
        </Field>
        <Field label="CAGE">
          <input
            className="aur-input"
            value={cage}
            onChange={(e) => setCage(e.target.value.toUpperCase())}
            placeholder="5 chars"
          />
        </Field>
        <Field label="Primary NAICS">
          <input
            className="aur-input"
            value={naics}
            onChange={(e) => setNaics(e.target.value)}
            placeholder="541512"
          />
        </Field>
        <Field label="State">
          <input
            className="aur-input"
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
            placeholder="VA"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Tag imports as">
          <select
            className="aur-input md:w-48"
            value={defaultRel}
            onChange={(e) => setDefaultRel(e.target.value as CompanyRelationship)}
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="aur-btn aur-btn-primary px-5 py-2.5 text-sm disabled:opacity-60"
          disabled={loading}
          onClick={search}
        >
          {loading ? "Searching…" : "Search SAM.gov"}
        </button>
      </div>

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

      {results ? (
        <div>
          <div className="mb-2 font-mono text-[11px] text-muted">
            {results.length} shown · {total} total matching registrations
          </div>
          {results.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No matches. Try a broader name or different NAICS.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((e) => (
                <li
                  key={e.ueiSAM}
                  className={`rounded-lg border p-3 ${
                    e.alreadyImported
                      ? "border-white/10 bg-white/[0.015] opacity-70"
                      : "border-white/10 bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-display text-[14px] font-semibold text-text">
                        {e.legalBusinessName}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                        UEI {e.ueiSAM}
                        {e.cageCode ? ` · CAGE ${e.cageCode}` : ""}
                        {e.primaryNaics ? ` · NAICS ${e.primaryNaics}` : ""}
                        {e.physicalAddressCity || e.physicalAddressStateOrProvinceCode
                          ? ` · ${[e.physicalAddressCity, e.physicalAddressStateOrProvinceCode].filter(Boolean).join(", ")}`
                          : ""}
                      </div>
                      {e.sbaCertifications.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.sbaCertifications.map((s) => (
                            <span
                              key={s}
                              className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {e.alreadyImported ? (
                        <span className="rounded bg-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted">
                          Already imported
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
                          disabled={importingId === e.ueiSAM}
                          onClick={() => importOne(e.ueiSAM)}
                        >
                          {importingId === e.ueiSAM ? "Importing…" : "Import"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="aur-label">{label}</label>
      {children}
    </div>
  );
}
