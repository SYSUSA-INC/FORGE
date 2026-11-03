import { SamKeyNotice } from "@/components/ui/SamKeyNotice";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getSamKeyStatus } from "@/lib/samgov-key";
import { samKeyNotice } from "@/lib/samgov-key-logic";
import { safeQuery } from "@/lib/schema-resilience";
import {
  getScoutProfile,
  getScoutTrack,
  latestScoutRun,
  listScoutCandidates,
} from "@/lib/scout";
import {
  DEFAULT_SCOUT_PROFILE,
  EMPTY_SCOUT_TRACK,
  type ScoutCandidateView,
  type ScoutRunView,
} from "@/lib/scout-logic";
import { ScoutClient } from "./ScoutClient";
import { BringInSection } from "./BringInSection";
import type { IdentifySource } from "@/lib/identify-sources";

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

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

  const [profile, fresh, decided, track, lastRun, sam] = await Promise.all([
    safeQuery(() => getScoutProfile({ organizationId }), DEFAULT_SCOUT_PROFILE, { tag: "scout.profile" }),
    safeQuery<ScoutCandidateView[]>(
      () => listScoutCandidates({ organizationId, status: "new", limit: 60 }),
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
  ]);

  const pursue = fresh.filter((c) => c.recommendation === "pursue").length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl font-body text-[13px] leading-[1.5] text-muted">
          Every night the scout re-runs your NAICS codes and keywords against SAM.gov, checks your watchlist for expiring awards, scores each find against your own history and recommends pursue, watch or skip. <strong>Add to pipeline</strong> puts a find in the pipeline; <strong>Not for us</strong> sets it aside; both teach the scout your taste. Every other source is under{" "}
          <a href="#bring-in" className="font-medium text-cobalt hover:underline">Bring in an opportunity</a> below.
        </p>
        <dl className="flex flex-wrap gap-6 font-mono text-[11px] text-muted">
          <div><dt className="uppercase tracking-label">New finds</dt><dd className="font-display text-xl text-text">{fresh.length}</dd></div>
          <div><dt className="uppercase tracking-label">Recommended pursue</dt><dd className="font-display text-xl text-text">{pursue}</dd></div>
          <div><dt className="uppercase tracking-label">Scout accuracy</dt><dd className="font-display text-xl text-text">{track.accuracy === null ? "—" : `${Math.round(track.accuracy * 100)}%`}</dd></div>
          <div><dt className="uppercase tracking-label">Last run</dt><dd className="font-display text-xl text-text">{lastRun ? ago(lastRun.startedAt) : "never"}</dd></div>
        </dl>
      </div>
      {/* BL-STAB-7d — why the nightly SAM.gov searches would come back empty. */}
      <SamKeyNotice notice={samKeyNotice(sam)} />
      <ScoutClient
        profile={profile}
        candidates={fresh}
        decided={decided}
        track={track}
        lastRun={lastRun}
        isAdmin={isAdmin}
      />
      <div id="bring-in" className="scroll-mt-6">
        <BringInSection organizationId={organizationId} source={source} />
      </div>
    </>
  );
}
