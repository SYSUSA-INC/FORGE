import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
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

export const dynamic = "force-dynamic";

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
export default async function ScoutPage() {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const isAdmin = user.role === "admin" || !!user.isSuperadmin;

  const [profile, fresh, decided, track, lastRun] = await Promise.all([
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
  ]);

  const pursue = fresh.filter((c) => c.recommendation === "pursue").length;

  return (
    <>
      <PageHeader
        eyebrow="Capture"
        title="Scout"
        subtitle="Every night the scout re-runs your NAICS codes and keywords against SAM.gov, checks your watchlist for expiring awards, scores each find against your own history and recommends pursue, watch or skip. Importing or dismissing a find grades the scout and teaches it your taste."
        actions={
          <Link href="/opportunities/import" className="aur-btn aur-btn-ghost">
            Search SAM.gov yourself
          </Link>
        }
        meta={[
          { label: "New finds", value: String(fresh.length).padStart(2, "0") },
          {
            label: "Recommended pursue",
            value: String(pursue).padStart(2, "0"),
            accent: pursue > 0 ? "emerald" : undefined,
          },
          {
            label: "Scout accuracy",
            value: track.accuracy === null ? "—" : `${Math.round(track.accuracy * 100)}%`,
          },
          { label: "Last run", value: lastRun ? ago(lastRun.startedAt) : "never" },
        ]}
      />
      <ScoutClient
        profile={profile}
        candidates={fresh}
        decided={decided}
        track={track}
        lastRun={lastRun}
        isAdmin={isAdmin}
      />
    </>
  );
}
