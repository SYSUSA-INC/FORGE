import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import {
  searchAwardsByCriteria,
  type UsaspendingAward,
} from "@/lib/usaspending";
import {
  lookupSba8aChipsAction,
  type Sba8aChipWire,
} from "../../../intelligence/awards/actions";
import { listWatchedExternalIdsAction } from "../../../intelligence/watchlist/actions";
import { SimilarAwardsClient } from "./SimilarAwardsClient";

export const dynamic = "force-dynamic";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
  "rfp",
  "rfq",
  "rfi",
  "ifb",
  "sources",
  "sought",
  "service",
  "services",
  "contract",
]);

/**
 * Extract a short keyword phrase from an opportunity title. Drops
 * stop-words and punctuation, takes the first 5 meaningful tokens.
 * Returns "" when the result would be too short to be useful.
 */
function deriveKeyword(title: string): string {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const trimmed = tokens.slice(0, 5).join(" ").trim();
  return trimmed.length >= 4 ? trimmed : "";
}

export default async function OpportunitySimilarAwardsPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [opp] = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, params.id),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!opp) notFound();

  const enabled = process.env.AWARDS_INTEL_ENABLED === "1";
  if (!enabled) {
    return (
      <Panel title="Preview feature" eyebrow="Disabled by default">
        <p className="font-mono text-[12px] text-muted">
          Similar-awards lookup is gated behind{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5">
            AWARDS_INTEL_ENABLED
          </code>
          .
        </p>
      </Panel>
    );
  }

  const naicsCodes = opp.naicsCode
    ? [opp.naicsCode.replace(/[^0-9]/g, "")].filter(Boolean)
    : [];
  const agency = (opp.agency || "").trim();
  const keyword = deriveKeyword(opp.title || "");

  // Need at least one of NAICS / agency / keyword for a useful search.
  if (!naicsCodes.length && !agency && !keyword) {
    return (
      <Panel title="No signals" eyebrow="Similar awards">
        <p className="font-mono text-[12px] text-muted">
          Add a NAICS code, agency, or a descriptive title on this opportunity
          to surface comparable historical awards from USAspending.
        </p>
      </Panel>
    );
  }

  const search = await searchAwardsByCriteria({
    naicsCodes,
    awardingAgencyName: agency,
    keyword,
    limit: 20,
  });
  if (!search.ok) {
    return (
      <Panel title="Couldn't load similar awards" eyebrow="Upstream error" accent="hazard">
        <p className="font-mono text-[12px] text-rose-200">{search.error}</p>
        <p className="mt-2 font-mono text-[11px] text-muted">
          Try{" "}
          <Link
            href={`/intelligence/awards?savedSearch=`}
            className="underline"
          >
            /intelligence/awards
          </Link>{" "}
          to refine the query manually.
        </p>
      </Panel>
    );
  }

  // Fire the two side-look-ups in parallel; failures degrade gracefully.
  const recipients = search.awards.map((a) => ({
    uei: a.recipientUei,
    name: a.recipientName,
  }));
  const externalIds = search.awards
    .map((a) => internalIdFromAward(a))
    .filter(Boolean);

  const [chips, watched] = await Promise.all([
    recipients.length ? lookupSba8aChipsAction(recipients) : Promise.resolve([] as Sba8aChipWire[]),
    externalIds.length
      ? listWatchedExternalIdsAction("award", externalIds)
      : Promise.resolve([] as string[]),
  ]);

  return (
    <SimilarAwardsClient
      awards={search.awards}
      totalRecords={search.totalRecords}
      chips={chips}
      initialWatchedIds={watched}
      criteriaSummary={summariseCriteria(naicsCodes, agency, keyword)}
    />
  );
}

function summariseCriteria(
  naicsCodes: string[],
  agency: string,
  keyword: string,
): string {
  const parts: string[] = [];
  if (naicsCodes.length) parts.push(`NAICS ${naicsCodes.join(", ")}`);
  if (agency) parts.push(`Agency ${agency}`);
  if (keyword) parts.push(`"${keyword}"`);
  return parts.join(" · ");
}

function internalIdFromAward(a: UsaspendingAward): string {
  if (!a.uiUrl) return "";
  const m = a.uiUrl.match(/\/award\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
