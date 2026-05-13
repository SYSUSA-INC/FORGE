"use server";

import { inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { certFirms } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  buildSba8aChipIndex,
  normalizeFirmName,
  type Sba8aChip,
} from "@/lib/sba-8a";
import { safeQuery } from "@/lib/schema-resilience";
import {
  searchAwardsByCriteria,
  type AwardsSearchCriteria,
  type UsaspendingAward,
} from "@/lib/usaspending";

export type AwardsIntelSearchResult =
  | { ok: true; awards: UsaspendingAward[]; totalRecords: number }
  | { ok: false; error: string };

export async function searchAwardsIntelAction(
  criteria: AwardsSearchCriteria,
): Promise<AwardsIntelSearchResult> {
  await requireAuth();
  await requireCurrentOrg();

  if (process.env.AWARDS_INTEL_ENABLED !== "1") {
    return {
      ok: false,
      error:
        "Awards intel is in preview. Ask an admin to set AWARDS_INTEL_ENABLED=1.",
    };
  }

  return searchAwardsByCriteria({
    ...criteria,
    limit: Math.min(100, criteria.limit ?? 50),
  });
}

/**
 * Wire-format chip for a single recipient. Server-action boundaries
 * can't carry `Date`, so dates are serialised to `YYYY-MM-DD`.
 */
export type Sba8aChipWire = {
  /** Key the client uses to look this chip up — same as the input key
   *  (UEI uppercased, or normalized name when UEI is missing). */
  key: string;
  uei: string;
  firmName: string;
  status: string;
  certExitDate: string | null;
  matchedBy: "uei" | "name";
};

/**
 * Look up the 8(a) chip data for a batch of award recipients. The
 * client posts the list of (uei, name) pairs surfaced by USAspending;
 * we resolve them against the local `sba_8a_participant` table.
 * Returns a flat array keyed by the same key the chip builder uses,
 * so the client can build a Map without re-running normalisation.
 */
export async function lookupSba8aChipsAction(
  recipients: { uei: string; name: string }[],
): Promise<Sba8aChipWire[]> {
  await requireAuth();
  await requireCurrentOrg();
  if (!recipients.length) return [];

  const ueis = Array.from(
    new Set(
      recipients
        .map((r) => (r.uei || "").toUpperCase().trim())
        .filter(Boolean),
    ),
  );
  const names = Array.from(
    new Set(
      recipients
        .map((r) => normalizeFirmName(r.name || ""))
        .filter(Boolean),
    ),
  );
  if (!ueis.length && !names.length) return [];

  return safeQuery<Sba8aChipWire[]>(
    async () => {
      const rows = await db
        .select()
        .from(certFirms)
        .where(
          ueis.length && names.length
            ? or(
                inArray(certFirms.uei, ueis),
                inArray(certFirms.firmNameNorm, names),
              )
            : ueis.length
              ? inArray(certFirms.uei, ueis)
              : inArray(certFirms.firmNameNorm, names),
        )
        .limit(1000);

      const catalogue = rows.map((r) => ({
        uei: r.uei,
        certType: r.certType,
        firmName: r.firmName,
        firmNameNorm: r.firmNameNorm,
        certEntryDate: r.certEntryDate,
        certExitDate: r.certExitDate,
        status: r.status,
        naicsPrimary: r.naicsPrimary,
        city: r.city,
        state: r.state,
        source: r.source,
        sourceUpdatedAt: r.sourceUpdatedAt ?? new Date(0),
      }));

      const index = buildSba8aChipIndex(recipients, catalogue);
      const out: Sba8aChipWire[] = [];
      index.forEach((chip: Sba8aChip, key: string) => {
        out.push({
          key,
          uei: chip.uei,
          firmName: chip.firmName,
          status: chip.status,
          certExitDate: chip.certExitDate
            ? chip.certExitDate.toISOString().slice(0, 10)
            : null,
          matchedBy: chip.matchedBy,
        });
      });
      return out;
    },
    [],
    { tag: "lookupSba8aChipsAction" },
  );
}
