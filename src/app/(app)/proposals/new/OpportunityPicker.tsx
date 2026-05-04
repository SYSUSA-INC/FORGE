"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type OppOption = {
  id: string;
  title: string;
  agency: string;
  solicitationNumber: string;
};

/**
 * Path 1 of the proposal launcher — pick an opportunity from the
 * queue and continue to the proposal setup form. Lightweight client
 * component because we want a free-text filter without a full form.
 */
export function OpportunityPicker({
  opportunities,
}: {
  opportunities: OppOption[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string>(
    opportunities[0]?.id ?? "",
  );

  const f = filter.trim().toLowerCase();
  const filtered = f
    ? opportunities.filter(
        (o) =>
          o.title.toLowerCase().includes(f) ||
          o.agency.toLowerCase().includes(f) ||
          o.solicitationNumber.toLowerCase().includes(f),
      )
    : opportunities;

  // If the active selection scrolls out of the filter, fall back to
  // the first match so the Continue button is never disabled in the
  // middle of typing.
  const effectiveId = filtered.find((o) => o.id === selectedId)
    ? selectedId
    : filtered[0]?.id ?? "";

  function go() {
    if (!effectiveId) return;
    router.push(`/proposals/new?opportunityId=${effectiveId}`);
  }

  return (
    <>
      <input
        className="aur-input text-[12px]"
        placeholder="Filter by title, agency, solicitation #…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <select
        className="aur-input text-[12px]"
        value={effectiveId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={filtered.length === 0}
      >
        {filtered.length === 0 ? (
          <option value="">No matches</option>
        ) : (
          filtered.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
              {o.solicitationNumber ? ` · ${o.solicitationNumber}` : ""}
              {o.agency ? ` · ${o.agency}` : ""}
            </option>
          ))
        )}
      </select>
      <button
        type="button"
        onClick={go}
        disabled={!effectiveId}
        className="aur-btn aur-btn-primary inline-flex w-full items-center justify-center disabled:opacity-60"
      >
        Continue →
      </button>
    </>
  );
}
