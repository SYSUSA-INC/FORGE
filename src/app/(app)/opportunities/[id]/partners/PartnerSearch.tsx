"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { formatMoney, PARTNER_CERT_LABELS, PARTNER_CERTS, PARTNER_SOURCE_LABELS, PARTNER_SEARCH_YEARS, reasonFromFacts, type PartnerHit, type SetAsideNeed } from "@/lib/partner-search-logic";
import { addSearchedPartnerAction, searchPartnersAction } from "./actions";

type Found = { hits: PartnerHit[]; notes: string[]; criteria: { naics: string; agency: string; setAside: string; need: SetAsideNeed } };

function needLabel(need: SetAsideNeed): string {
  if (!need) return "";
  return need === "small" ? "small business" : PARTNER_CERT_LABELS[need];
}

/**
 * BL-NAV-LIFECYCLE phase 3a-2 (C-2) — Find partners: the partner database
 * for this opportunity (USAspending, the certification registry, SAM.gov,
 * your Companies, joined by UEI), each firm with the facts that put it
 * on the list, and Add, which puts it in Companies and on this
 * opportunity's partners.
 */
export function PartnerSearch(props: { opportunityId: string; naics: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState("");
  const [cert, setCert] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [rel, setRel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function search() {
    setError(null);
    start(async () => {
      const res = await searchPartnersAction({ opportunityId: props.opportunityId, state, cert });
      if (!res.ok) {
        setFound(null);
        return setError(res.error);
      }
      setFound({ hits: res.hits, notes: res.notes, criteria: res.criteria });
    });
  }

  function add(h: PartnerHit) {
    setError(null);
    setBusy(h.uei);
    start(async () => {
      const res = await addSearchedPartnerAction({
        opportunityId: props.opportunityId,
        uei: h.uei,
        name: h.name,
        city: h.city,
        state: h.state,
        relationship: rel[h.uei] ?? (h.company?.relationship === "subcontractor" ? "subcontractor" : "teaming_partner"),
        reason: reasonFromFacts(h.facts),
      });
      setBusy(null);
      if (!res.ok) return setError(res.error);
      setAdded((s) => new Set(s).add(h.uei));
      router.refresh();
    });
  }

  const need = found?.criteria.need ?? null;

  return (
    <Panel title="Find partners" eyebrow="SAM.gov · certification registry · USAspending · your Companies">
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        Firms under NAICS {props.naics || "(not set)"}: contract awards in the last {PARTNER_SEARCH_YEARS} years (and at this agency), current SBA certifications, active SAM.gov registrations, and your own Companies, joined by UEI. Awards at this agency come first.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-28">
          <span className="aur-label">Based in</span>
          <input className="aur-input mt-1 uppercase" value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="Any state" aria-label="State code" />
        </label>
        <label className="min-w-[12rem]">
          <span className="aur-label">Certification</span>
          <select className="aur-input mt-1" value={cert} onChange={(e) => setCert(e.target.value)}>
            <option value="">Any</option>
            {PARTNER_CERTS.map((c) => (
              <option key={c} value={c}>
                {PARTNER_CERT_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="aur-btn aur-btn-primary" disabled={pending || !props.naics} onClick={search}>
          {pending && !busy ? "Searching…" : found ? "Search again" : "Search"}
        </button>
      </div>
      {error ? <p className="mt-2 font-body text-[12px] text-red">{error}</p> : null}
      {found ? (
        <div className="mt-4">
          {found.notes.map((n) => (
            <p key={n} className="mb-1 font-body text-[12px] text-brass">
              {n}
            </p>
          ))}
          <p className="mb-2 font-mono text-[11px] uppercase tracking-label text-muted">
            {found.hits.length} firm{found.hits.length === 1 ? "" : "s"} · NAICS {found.criteria.naics}
            {found.criteria.agency ? ` · ${found.criteria.agency}` : ""}
            {need ? ` · set-aside ${needLabel(need)}` : ""}
          </p>
          {found.hits.length === 0 ? (
            <p className="font-body text-[13px] text-muted">No firm found. Try without a state or certification.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-layer/10">
              {found.hits.map((h) => {
                const onIt = h.considered || added.has(h.uei);
                return (
                  <li key={h.uei} className="flex flex-col gap-1 py-3 md:flex-row md:items-start md:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-[14px] text-text">
                        {h.name} <span className="font-mono text-[11px] text-muted">UEI {h.uei}</span>
                      </p>
                      <p className="font-mono text-[11px] text-muted">
                        {h.city || h.state ? [h.city, h.state].filter(Boolean).join(", ") : "Location not on record"} · {h.sources.map((s) => PARTNER_SOURCE_LABELS[s]).join(" · ")}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {h.certs.map((c) => (
                          <span key={c} className="rounded-sm border border-indigo/40 px-1.5 font-mono text-[10px] uppercase tracking-widest text-indigo">
                            {PARTNER_CERT_LABELS[c]}
                          </span>
                        ))}
                        {h.keepsSetAside === true ? (
                          <span className="rounded-sm border border-green/50 bg-green/10 px-1.5 font-mono text-[10px] uppercase tracking-widest text-green">Keeps the {needLabel(need)} set-aside</span>
                        ) : h.keepsSetAside === false ? (
                          <span className="rounded-sm border border-brass/50 px-1.5 font-mono text-[10px] uppercase tracking-widest text-brass">Not {needLabel(need)} on record</span>
                        ) : null}
                      </div>
                      <ul className="mt-1 list-disc pl-4 font-body text-[12px] leading-[1.5] text-muted">
                        {h.facts.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                      {h.awards?.top[0]?.url ? (
                        <p className="mt-1 font-body text-[12px] text-muted">
                          Largest award:{" "}
                          <a href={h.awards.top[0].url} target="_blank" rel="noreferrer" className="aur-link text-[12px]">
                            {formatMoney(h.awards.top[0].amount)}
                            {h.awards.top[0].agency ? `, ${h.awards.top[0].agency}` : ""}
                          </a>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {onIt ? (
                        <span className="font-mono text-[10px] uppercase tracking-widest text-green">On this opportunity</span>
                      ) : (
                        <>
                          {h.company ? null : (
                            <select className="aur-input w-40" value={rel[h.uei] ?? "teaming_partner"} onChange={(e) => setRel((r) => ({ ...r, [h.uei]: e.target.value }))} aria-label={`Relationship for ${h.name}`}>
                              <option value="teaming_partner">Teaming partner</option>
                              <option value="subcontractor">Subcontractor</option>
                            </select>
                          )}
                          <button type="button" className="aur-btn" disabled={pending} onClick={() => add(h)}>
                            {busy === h.uei ? "Adding…" : "Add"}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
