"use client";

import { useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { normalizeFirmName } from "@/lib/sba-8a";
import { type UsaspendingAward } from "@/lib/usaspending";
import {
  AwardRow,
  internalIdFromAward,
} from "../../../intelligence/awards/AwardRow";
import { type Sba8aChipWire } from "../../../intelligence/awards/actions";
import { saveWatchlistItemAction } from "../../../intelligence/watchlist/actions";

/**
 * Renders the similar-awards results list with the same look-and-feel
 * as /intelligence/awards. Owns watchlist state for the visible page
 * (parent fetches the initial "already-watched" set server-side, then
 * this component mutates locally on save).
 */
export function SimilarAwardsClient({
  awards,
  totalRecords,
  chips,
  initialWatchedIds,
  criteriaSummary,
}: {
  awards: UsaspendingAward[];
  totalRecords: number;
  chips: Sba8aChipWire[];
  initialWatchedIds: string[];
  criteriaSummary: string;
}) {
  const chipIndex = new Map(chips.map((c) => [c.key, c]));
  const [watchedIds, setWatchedIds] = useState<Set<string>>(
    new Set(initialWatchedIds),
  );
  const [error, setError] = useState<string | null>(null);

  function chipFor(award: UsaspendingAward): Sba8aChipWire | undefined {
    const key =
      (award.recipientUei || "").toUpperCase().trim() ||
      normalizeFirmName(award.recipientName || "");
    return chipIndex.get(key);
  }

  function toggleWatch(award: UsaspendingAward) {
    const id = internalIdFromAward(award);
    if (!id || watchedIds.has(id)) return;
    setWatchedIds((prev) => new Set(prev).add(id));
    const chip = chipFor(award);
    void (async () => {
      const res = await saveWatchlistItemAction({
        kind: "award",
        externalId: id,
        label: `${award.recipientName || "—"} · ${award.awardId}`,
        metadata: {
          awardId: award.awardId,
          recipientName: award.recipientName,
          amount: award.amount,
          awardingAgency: award.awardingAgency,
          awardingSubAgency: award.awardingSubAgency,
          endDate: award.endDate ?? "",
          naicsCode: award.naicsCode,
          setAsideCode: award.setAsideCode,
          sba8aStatus: chip?.status ?? "",
        },
      });
      if (!res.ok) {
        setError(res.error);
        setWatchedIds((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    })();
  }

  if (awards.length === 0) {
    return (
      <Panel title="No similar awards found" eyebrow={criteriaSummary || "—"}>
        <p className="font-mono text-[12px] text-muted">
          USAspending returned no contract awards matching this opportunity's
          NAICS + agency + title keywords across the last 7 fiscal years.
          Refine the search manually at{" "}
          <Link href="/intelligence/awards" className="underline">
            /intelligence/awards
          </Link>
          .
        </p>
      </Panel>
    );
  }

  return (
    <>
      {error ? (
        <div className="mb-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[12px] text-rose-200">
          {error}
        </div>
      ) : null}
      <Panel
        title="Similar past awards"
        eyebrow={`${awards.length} shown · ${totalRecords.toLocaleString()} total · ${criteriaSummary}`}
        actions={
          <Link
            href="/intelligence/awards"
            className="aur-btn aur-btn-ghost text-[11px]"
            title="Refine the search on the intel page"
          >
            Refine search →
          </Link>
        }
      >
        <ul className="flex flex-col gap-2">
          {awards.map((a) => {
            const id = internalIdFromAward(a);
            return (
              <AwardRow
                key={a.awardId}
                award={a}
                chip={chipFor(a)}
                watched={id ? watchedIds.has(id) : false}
                canWatch={!!id}
                onWatch={() => toggleWatch(a)}
              />
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
