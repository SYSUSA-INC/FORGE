"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import type { RankedHit } from "@/lib/partner-rank";
import { formatMoney, PARTNER_CERT_LABELS, PARTNER_CERTS, PARTNER_SOURCE_LABELS, PARTNER_SEARCH_YEARS, reasonFromFacts, type PartnerHit, type SetAsideNeed } from "@/lib/partner-search-logic";
import { addSearchedPartnerAction, rankPartnersAction, searchPartnersAction } from "./actions";

type Found = { hits: PartnerHit[]; notes: string[]; criteria: { naics: string; agency: string; setAside: string; need: SetAsideNeed; widened: boolean } };
type Mode = "plain" | "ai";

function needLabel(need: SetAsideNeed): string {
  if (!need) return "";
  return need === "small" ? "small business" : PARTNER_CERT_LABELS[need];
}

/**
 * BL-NAV-LIFECYCLE phase 3a-2 / 3b (C-2, C-3, C-4) — Find partners: the
 * partner database for this opportunity (USAspending, the certification
 * registry, SAM.gov, your Companies, joined by UEI). FORGE AI ranks the
 * best ten with a reason each, every reason resting on facts the search
 * returned (shown under it). Find more widens the search to the NAICS
 * family and any state. Add puts a firm in Companies and on this
 * opportunity's partners.
 */
export function PartnerSearch(props: { opportunityId: string; naics: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState("");
  const [cert, setCert] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [ranked, setRanked] = useState<RankedHit[] | null>(null);
  const [dropped, setDropped] = useState(0);
  const [mode, setMode] = useState<Mode>("ai");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [rel, setRel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState<Mode | null>(null);

  function run(next: Mode, widen: boolean) {
    setError(null);
    setMode(next);
    setRunning(next);
    start(async () => {
      if (next === "ai") {
        const res = await rankPartnersAction({ opportunityId: props.opportunityId, state, cert, widen });
        setRunning(null);
        if (!res.ok) return setError(res.error);
        setFound({ hits: res.hits, notes: res.notes, criteria: res.criteria });
        setRanked(res.ranked);
        setDropped(res.dropped);
        return;
      }
      const res = await searchPartnersAction({ opportunityId: props.opportunityId, state, cert, widen });
      setRunning(null);
      if (!res.ok) {
        setFound(null);
        setRanked(null);
        return setError(res.error);
      }
      setFound({ hits: res.hits, notes: res.notes, criteria: res.criteria });
      setRanked(null);
      setDropped(0);
    });
  }

  function add(h: PartnerHit, aiReason?: string) {
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
        reason: aiReason ?? reasonFromFacts(h.facts),
        fromAi: aiReason !== undefined,
      });
      setBusy(null);
      if (!res.ok) return setError(res.error);
      setAdded((s) => new Set(s).add(h.uei));
      router.refresh();
    });
  }

  const need = found?.criteria.need ?? null;
  const rankedUeis = new Set((ranked ?? []).map((r) => r.uei));
  const others = found ? found.hits.filter((h) => !rankedUeis.has(h.uei.toUpperCase())) : [];

  function row(h: PartnerHit, extra?: { n: number; reason: string; cited: string[] }) {
    const onIt = h.considered || added.has(h.uei);
    return (
      <li key={h.uei} className="flex flex-col gap-1 py-3 md:flex-row md:items-start md:gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-body text-[14px] text-text">
            {extra ? <span className="mr-2 font-mono text-[12px] text-cobalt">{extra.n}.</span> : null}
            {h.name} <span className="font-mono text-[11px] text-muted">UEI {h.uei}</span>
          </p>
          <p className="font-mono text-[11px] text-muted">
            {h.city || h.state ? [h.city, h.state].filter(Boolean).join(", ") : "Location not on record"} · {h.sources.map((s) => PARTNER_SOURCE_LABELS[s]).join(" · ")}
          </p>
          {extra ? (
            <div className="mt-1 border-l-2 border-cobalt/40 pl-3">
              <p className="font-body text-[13px] leading-[1.5] text-text">{extra.reason}</p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">Rests on</p>
              <ul className="list-disc pl-4 font-body text-[12px] leading-[1.5] text-muted">
                {extra.cited.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
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
          {extra ? null : (
            <ul className="mt-1 list-disc pl-4 font-body text-[12px] leading-[1.5] text-muted">
              {h.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
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
              <button type="button" className="aur-btn" disabled={pending} onClick={() => add(h, extra?.reason)}>
                {busy === h.uei ? "Adding…" : "Add"}
              </button>
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <Panel title="Find partners" eyebrow="SAM.gov · certification registry · USAspending · your Companies">
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        Firms under NAICS {props.naics || "(not set)"}: contract awards in the last {PARTNER_SEARCH_YEARS} years (and at this agency), current SBA certifications, active SAM.gov registrations, and your own Companies, joined by UEI. FORGE AI ranks the best 10 and says why, using only what the search found and the gaps in your capability matrix.
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
        <button type="button" className="aur-btn aur-btn-primary" disabled={pending || !props.naics} onClick={() => run("ai", false)}>
          {running === "ai" ? "FORGE AI is ranking…" : "Rank the best 10 with FORGE AI"}
        </button>
        <button type="button" className="aur-btn" disabled={pending || !props.naics} onClick={() => run("plain", false)}>
          {running === "plain" ? "Searching…" : "Search only"}
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
            {found.criteria.widened ? " · widened" : ""}
          </p>
          {ranked ? (
            <>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-label text-cobalt">FORGE AI's best {ranked.length}, in order. Advice: you choose.</p>
              {dropped > 0 ? (
                <p className="mb-1 font-body text-[12px] text-brass">
                  {dropped} pick{dropped === 1 ? "" : "s"} left out: the reason didn't rest on a fact the search returned.
                </p>
              ) : null}
              <ul className="flex flex-col divide-y divide-layer/10">{ranked.map((r, i) => row(r.hit, { n: i + 1, reason: r.reason, cited: r.cited }))}</ul>
            </>
          ) : null}
          {found.hits.length === 0 ? (
            <p className="font-body text-[13px] text-muted">No firm found. Try without a state or certification, or Find more.</p>
          ) : ranked ? (
            others.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-label text-muted">The other {others.length} firm{others.length === 1 ? "" : "s"} the search found</summary>
                <ul className="flex flex-col divide-y divide-layer/10">{others.map((h) => row(h))}</ul>
              </details>
            ) : null
          ) : (
            <ul className="flex flex-col divide-y divide-layer/10">{found.hits.map((h) => row(h))}</ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="aur-btn" disabled={pending || found.criteria.widened} onClick={() => run(mode, true)}>
              {running && found.criteria.widened === false ? "Finding more…" : "Find more"}
            </button>
            <span className="font-body text-[12px] text-muted">{found.criteria.widened ? "Already widened: the NAICS family, any state." : "Widens the search to the NAICS family and any state."}</span>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
