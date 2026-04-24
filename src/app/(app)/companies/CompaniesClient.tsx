"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import type { CompanyRelationship } from "@/db/schema";

type CompanyRow = {
  id: string;
  name: string;
  uei: string;
  cageCode: string;
  primaryNaics: string;
  city: string;
  state: string;
  registrationStatus: string;
  registrationExpirationDate: string | null;
  relationship: CompanyRelationship;
  sbaCertifications: string[];
  updatedAt: string;
  syncSource: string;
};

type RelationshipDef = {
  key: CompanyRelationship;
  label: string;
  color: string;
  description: string;
};

export function CompaniesClient({
  companies,
  relationships,
  relationshipLabels,
  relationshipColors,
  counts,
}: {
  companies: CompanyRow[];
  relationships: RelationshipDef[];
  relationshipLabels: Record<CompanyRelationship, string>;
  relationshipColors: Record<CompanyRelationship, string>;
  counts: Record<string, number>;
}) {
  const [filter, setFilter] = useState("");
  const [relFilter, setRelFilter] = useState<CompanyRelationship | "all">("all");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return companies.filter((c) => {
      if (relFilter !== "all" && c.relationship !== relFilter) return false;
      if (!f) return true;
      return (
        c.name.toLowerCase().includes(f) ||
        c.uei.toLowerCase().includes(f) ||
        c.cageCode.toLowerCase().includes(f) ||
        c.primaryNaics.toLowerCase().includes(f) ||
        c.city.toLowerCase().includes(f) ||
        c.state.toLowerCase().includes(f) ||
        c.sbaCertifications.some((s) => s.toLowerCase().includes(f))
      );
    });
  }, [companies, filter, relFilter]);

  return (
    <>
      <PageHeader
        eyebrow="Intel"
        title="Companies"
        subtitle="Track customers, primes, subcontractors, teaming partners, and competitors."
        actions={
          <>
            <Link href="/companies/search" className="aur-btn aur-btn-ghost">
              Search SAM.gov
            </Link>
            <Link href="/companies/new" className="aur-btn aur-btn-primary">
              + Add company
            </Link>
          </>
        }
        meta={[
          { label: "Total", value: String(companies.length) },
          {
            label: "Primes",
            value: String(counts.prime ?? 0),
            accent: counts.prime ? "emerald" : undefined,
          },
          {
            label: "Partners",
            value: String(
              (counts.teaming_partner ?? 0) + (counts.subcontractor ?? 0),
            ),
          },
          {
            label: "Competitors",
            value: String(counts.competitor ?? 0),
            accent: counts.competitor ? "rose" : undefined,
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRelFilter("all")}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
            relFilter === "all"
              ? "border-teal-400 bg-teal-400/10 text-text"
              : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
          }`}
        >
          All {companies.length}
        </button>
        {relationships.map((r) => {
          const n = counts[r.key] ?? 0;
          if (n === 0 && relFilter !== r.key) return null;
          const active = relFilter === r.key;
          return (
            <button
              key={r.key}
              onClick={() => setRelFilter(r.key)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "border-teal-400 bg-teal-400/10 text-text"
                  : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              {r.label} · {n}
            </button>
          );
        })}
      </div>

      <Panel
        title={relFilter === "all" ? "All companies" : relationshipLabels[relFilter]}
        eyebrow={`${filtered.length} of ${companies.length}`}
        actions={
          <input
            className="aur-input w-64 text-[12px]"
            placeholder="Search name, UEI, CAGE, NAICS…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        }
      >
        {filtered.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No companies match.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((c) => (
              <CompanyRowItem
                key={c.id}
                c={c}
                relColor={relationshipColors[c.relationship]}
                relLabel={relationshipLabels[c.relationship]}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function CompanyRowItem({
  c,
  relColor,
  relLabel,
}: {
  c: CompanyRow;
  relColor: string;
  relLabel: string;
}) {
  const loc = [c.city, c.state].filter(Boolean).join(", ");
  const expiry = c.registrationExpirationDate
    ? new Date(c.registrationExpirationDate).toLocaleDateString()
    : null;
  return (
    <Link
      href={`/companies/${c.id}`}
      className="grid grid-cols-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 transition-colors hover:border-white/20 md:grid-cols-[1fr_auto_auto_auto]"
    >
      <div className="min-w-0">
        <div className="truncate font-display text-[14px] font-semibold text-text">
          {c.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {c.uei ? `UEI ${c.uei}` : "—"}
          {c.cageCode ? ` · CAGE ${c.cageCode}` : ""}
          {c.primaryNaics ? ` · NAICS ${c.primaryNaics}` : ""}
        </div>
        {c.sbaCertifications.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {c.sbaCertifications.slice(0, 4).map((s) => (
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
      <span
        className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em]"
        style={{
          color: relColor,
          backgroundColor: `${relColor}1A`,
          border: `1px solid ${relColor}40`,
        }}
      >
        {relLabel}
      </span>
      <div className="font-mono text-[11px] text-muted">
        <div>Location</div>
        <div className={loc ? "text-text" : "text-muted"}>{loc || "—"}</div>
      </div>
      <div className="font-mono text-[11px] text-muted">
        <div>SAM expires</div>
        <div className={expiry ? "text-text" : "text-muted"}>{expiry ?? "—"}</div>
      </div>
    </Link>
  );
}
