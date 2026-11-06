import { SamKeyNotice } from "@/components/ui/SamKeyNotice";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getSamKeyStatus } from "@/lib/samgov-key";
import { samKeyNotice } from "@/lib/samgov-key-logic";
import { safeQuery } from "@/lib/schema-resilience";
import {
  getScoutProfile,
  getScoutTrack,
  latestScoutRun,
  countNewScoutCandidates,
  listScoutCandidates,
} from "@/lib/scout";
import {
  DEFAULT_SCOUT_PROFILE,
  EMPTY_SCOUT_TRACK,
  type ScoutCandidateView,
  type ScoutRunView,
} from "@/lib/scout-logic";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { naicsCodeOf } from "@/lib/scout-logic";
import { ScoutClient } from "./ScoutClient";
import { SourceBar, SourcePanel } from "./BringInSection";
import type { IdentifySource } from "@/lib/identify-sources";

/**
 * BL-AIP-7b — the Scout page: what the nightly scout found, its take on
 * each find, and the import / dismiss decisions that grade it.
 */
/**
 * BL-NAV-LIFECYCLE 1b — the Scout tab under Pipeline → Identify: what the
 * nightly scout found, each with Add to pipeline and Not for us, then
 * every other source on the same page.
 */
export async function ScoutSection({ source }: { source: IdentifySource | null }) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const isAdmin = user.role === "admin" || !!user.isSuperadmin;

  const [profile, fresh, decided, track, lastRun, sam, waiting] = await Promise.all([
    safeQuery(() => getScoutProfile({ organizationId }), DEFAULT_SCOUT_PROFILE, { tag: "scout.profile" }),
    safeQuery<ScoutCandidateView[]>(
      () => listScoutCandidates({ organizationId, status: "new", limit: 200 }),
      [],
      { tag: "scout.new" },
    ),
    safeQuery<ScoutCandidateView[]>(
      () => listScoutCandidates({ organizationId, status: "decided", limit: 20 }),
      [],
      { tag: "scout.decided" },
    ),
    safeQuery(() => getScoutTrack({ organizationId }), EMPTY_SCOUT_TRACK, { tag: "scout.track" }),
    safeQuery<ScoutRunView | null>(() => latestScoutRun({ organizationId }), null, { tag: "scout.run" }),
    getSamKeyStatus(organizationId),
    safeQuery(() => countNewScoutCandidates({ organizationId }), { total: 0, unreviewed: 0 }, { tag: "scout.count" }),
  ]);

  // The organization's own codes: the scout searches them after the bar's (BL-STAB-10d).
  const [org] = await db.select({ primary: organizations.primaryNaics, list: organizations.naicsList }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const orgCodes = [...new Set([org?.primary ?? "", ...(org?.list ?? [])].map((c) => naicsCodeOf(c)).filter(Boolean))];

  return (
    <>
      <p className="mb-3 max-w-3xl font-body text-[13px] leading-[1.5] text-muted">
        Every source on one page. <strong>All</strong> is what the scout finds every night on SAM.gov and your watchlist, scored and reviewed by the AI; the other tabs search SAM.gov for something specific, read a pasted GSA eBuy RFQ or GSA email, or ask for a source FORGE doesn&apos;t read yet. <strong>Add to pipeline</strong> on any row puts it in the pipeline under Identified; <strong>Not for us</strong> sets a find aside, and both teach the scout your taste.
      </p>
      <SourceBar source={source} />
      {/* BL-STAB-7d — why the SAM.gov searches would come back empty. */}
      {!source || source.key === "sam" ? <SamKeyNotice notice={samKeyNotice(sam)} /> : null}
      {source ? (
        <SourcePanel organizationId={organizationId} source={source} />
      ) : (
        <ScoutClient
          profile={profile}
          orgCodes={orgCodes}
          candidates={fresh}
          unreviewedTotal={waiting.unreviewed}
          waitingTotal={Math.max(waiting.total, fresh.length)}
          decided={decided}
          track={track}
          lastRun={lastRun}
          isAdmin={isAdmin}
        />
      )}
    </>
  );
}
