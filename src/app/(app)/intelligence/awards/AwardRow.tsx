"use client";

import {
  isLikelyRecompete,
  setAsideLabel,
  type UsaspendingAward,
} from "@/lib/usaspending";
import type { Sba8aChipWire } from "./actions";

/**
 * Display row for a USAspending award with optional 8(a) enrichment
 * and a save-to-watchlist button. Used on /intelligence/awards and on
 * the opportunity Similar-awards tab.
 *
 * Pure display — receives `watched`, `chip`, and `onWatch` as props.
 * The parent owns watchlist state and the 8(a) chip-index lookup, so
 * the same row can render in different host contexts (search page,
 * opportunity detail, future surfaces) without duplicating logic.
 */
export function AwardRow({
  award,
  chip,
  watched,
  canWatch,
  onWatch,
}: {
  award: UsaspendingAward;
  chip: Sba8aChipWire | undefined;
  watched: boolean;
  canWatch: boolean;
  onWatch: () => void;
}) {
  const recompete = isLikelyRecompete(award);
  const period =
    award.startDate && award.endDate
      ? `${award.startDate} → ${award.endDate}`
      : award.startDate || award.endDate || "—";
  const setAside = setAsideLabel(award.setAsideCode);
  return (
    <li
      className={`rounded-lg border p-3 transition-colors ${
        recompete
          ? "border-amber-400/60 bg-amber-400/5"
          : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-[14px] font-semibold text-text">
              {award.awardId}
            </span>
            {recompete ? (
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-300">
                Recompete soon
              </span>
            ) : null}
            {award.awardType ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                {award.awardType}
              </span>
            ) : null}
            {setAside ? (
              <span className="rounded bg-teal-400/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-teal">
                {setAside}
              </span>
            ) : null}
            {chip ? (
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                  chip.status === "graduated"
                    ? "bg-amber-500/15 text-amber-200"
                    : chip.status === "active"
                      ? "bg-teal-500/15 text-teal-200"
                      : "bg-white/5 text-muted"
                }`}
                title={
                  chip.matchedBy === "name"
                    ? "8(a) match via firm name (no UEI available)"
                    : "8(a) match via UEI"
                }
              >
                8(a) {chip.status}
                {chip.certExitDate ? ` · ${chip.certExitDate.slice(0, 7)}` : ""}
                {chip.matchedBy === "name" ? " ~" : ""}
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {[award.awardingSubAgency, award.awardingAgency]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">
            <span className="text-text">{award.recipientName}</span>
            {award.naicsCode ? ` · NAICS ${award.naicsCode}` : ""}
            {award.pscCode ? ` · PSC ${award.pscCode}` : ""}
          </div>
          {award.description ? (
            <div className="mt-2 line-clamp-3 font-body text-[12px] text-muted">
              {award.description}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          {award.amount ? (
            <div className="font-display text-[14px] font-bold text-text">
              {formatUsd(award.amount)}
            </div>
          ) : null}
          <div className="mt-0.5 font-mono text-[10px] text-muted">{period}</div>
          {award.uiUrl ? (
            <a
              href={award.uiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block font-mono text-[10px] text-teal hover:underline"
            >
              View on USAspending ↗
            </a>
          ) : null}
          {canWatch ? (
            <div className="mt-1">
              <button
                type="button"
                onClick={onWatch}
                disabled={watched}
                className="aur-btn aur-btn-ghost text-[10px] uppercase tracking-[0.18em] disabled:text-emerald-300"
                title={watched ? "Already on watchlist" : "Save to watchlist"}
              >
                {watched ? "★ Saved" : "☆ Save"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Extract the USAspending generated_internal_id from a normalised
 * award's uiUrl. The stable watchlist key — it survives PIID renames
 * and is what USAspending uses as the deeplink primary key. Returns
 * "" when uiUrl is missing/unparseable.
 */
export function internalIdFromAward(a: UsaspendingAward): string {
  if (!a.uiUrl) return "";
  const m = a.uiUrl.match(/\/award\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
