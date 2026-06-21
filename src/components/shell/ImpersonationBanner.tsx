import { db } from "@/db";
import { eq } from "drizzle-orm";
import {
  organizations,
  superadminImpersonationSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth-helpers";
import { getActiveImpersonationSession } from "@/lib/impersonation";
import { EndImpersonationButton } from "./EndImpersonationButton";

/**
 * BL-15 Phase B-3b — top-of-app banner shown while an impersonation
 * session is active. Renders nothing for normal users, normal
 * super-admin browsing, and during sign-in flow.
 *
 * Server component on purpose: needs to consult the DB to read the
 * active session + look up the target tenant's name.
 */
export async function ImpersonationBanner() {
  const user = await getSessionUser();
  if (!user?.isSuperadmin) return null;
  const session = await getActiveImpersonationSession(user.id);
  if (!session) return null;

  const [target] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, session.targetOrganizationId))
    .limit(1);

  // Defence in depth: also read the row from the DB to surface a clean
  // expiry timestamp (the helper already validated unexpired, but we
  // want to show "expires in N min").
  const [row] = await db
    .select({ expiresAt: superadminImpersonationSessions.expiresAt })
    .from(superadminImpersonationSessions)
    .where(eq(superadminImpersonationSessions.id, session.id))
    .limit(1);

  const minutesRemaining = row?.expiresAt
    ? Math.max(0, Math.round((row.expiresAt.getTime() - Date.now()) / 60_000))
    : 0;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-text md:px-6"
      style={{
        background:
          "linear-gradient(90deg, rgba(220, 38, 38, 0.45), rgba(220, 38, 38, 0.65), rgba(220, 38, 38, 0.45))",
        borderColor: "rgba(248, 113, 113, 0.55)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
        <span aria-hidden>🚨</span>
        <span className="uppercase tracking-[0.18em] font-semibold">
          Impersonating
        </span>
        <span className="rounded bg-black/30 px-1.5 py-0.5">
          {target?.name ?? "unknown tenant"}
        </span>
        <span className="hidden md:inline text-white/80">
          · reason:{" "}
          <span className="italic">
            {truncate(session.reason, 90)}
          </span>
        </span>
        <span className="hidden lg:inline text-white/70">
          · expires in {minutesRemaining}m
        </span>
      </div>
      <EndImpersonationButton />
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
