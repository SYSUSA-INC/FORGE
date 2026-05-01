/**
 * Cross-org audit feed for the SuperAdmin portal.
 *
 * Pulls recent platform-level events from the existing tables —
 * organization creations/disablements, user signups/disablements/
 * superadmin toggles, opportunity activities (which already include
 * stage_change kinds), and proposal stage changes inferred from the
 * proposal table.
 *
 * Read-only; does not introduce a new audit table.
 */
import "server-only";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  organizations,
  proposals,
  users,
} from "@/db/schema";

export type AuditEventKind =
  | "org_created"
  | "org_disabled"
  | "user_created"
  | "user_disabled"
  | "opportunity_created"
  | "opportunity_activity"
  | "proposal_created"
  | "proposal_updated";

export type AuditEvent = {
  id: string;
  at: string; // ISO
  kind: AuditEventKind;
  actorName: string;
  actorEmail: string;
  organizationName: string;
  title: string;
  detail: string;
};

const PER_BUCKET = 25;

export async function getRecentAuditEvents(): Promise<AuditEvent[]> {
  const [orgRows, userRows, oppRows, oppActs, propRows] = await Promise.all([
    // Recent org creations + disablements (one row per org; we emit
    // both events if disabled).
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
        disabledAt: organizations.disabledAt,
      })
      .from(organizations)
      .orderBy(desc(organizations.createdAt))
      .limit(PER_BUCKET),

    // Recent user signups + disablements.
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
        disabledAt: users.disabledAt,
        isSuperadmin: users.isSuperadmin,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(PER_BUCKET),

    // Recent opportunity creations.
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        organizationId: opportunities.organizationId,
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .orderBy(desc(opportunities.createdAt))
      .limit(PER_BUCKET),

    // Recent opportunity activities (stage_change, note, evaluation,
    // etc.) — already a per-event table.
    db
      .select({
        id: opportunityActivities.id,
        opportunityId: opportunityActivities.opportunityId,
        userId: opportunityActivities.userId,
        kind: opportunityActivities.kind,
        title: opportunityActivities.title,
        body: opportunityActivities.body,
        createdAt: opportunityActivities.createdAt,
      })
      .from(opportunityActivities)
      .orderBy(desc(opportunityActivities.createdAt))
      .limit(PER_BUCKET),

    // Recent proposal updates (we don't have a dedicated stage-change
    // log, so we surface the most recently touched proposals).
    db
      .select({
        id: proposals.id,
        title: proposals.title,
        organizationId: proposals.organizationId,
        stage: proposals.stage,
        createdAt: proposals.createdAt,
        updatedAt: proposals.updatedAt,
      })
      .from(proposals)
      .where(isNotNull(proposals.updatedAt))
      .orderBy(desc(proposals.updatedAt))
      .limit(PER_BUCKET),
  ]);

  // Resolve org names for opportunities/proposals + user names for
  // opportunity activities (one round trip each, batched).
  const orgIds = new Set<string>([
    ...oppRows.map((r) => r.organizationId),
    ...propRows.map((r) => r.organizationId),
  ]);
  const userIdsForActs = new Set<string>(
    oppActs.map((a) => a.userId).filter((id): id is string => Boolean(id)),
  );
  const oppIdsForActs = new Set<string>(oppActs.map((a) => a.opportunityId));

  const [orgLookup, userLookup, oppLookup] = await Promise.all([
    orgIds.size
      ? db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
      : Promise.resolve([] as { id: string; name: string }[]),
    userIdsForActs.size
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
    oppIdsForActs.size
      ? db
          .select({
            id: opportunities.id,
            title: opportunities.title,
            organizationId: opportunities.organizationId,
          })
          .from(opportunities)
      : Promise.resolve(
          [] as { id: string; title: string; organizationId: string }[],
        ),
  ]);

  const orgNameById = new Map(orgLookup.map((o) => [o.id, o.name]));
  const userById = new Map(userLookup.map((u) => [u.id, u]));
  const oppById = new Map(oppLookup.map((o) => [o.id, o]));

  const events: AuditEvent[] = [];

  for (const o of orgRows) {
    events.push({
      id: `org-create-${o.id}`,
      at: o.createdAt.toISOString(),
      kind: "org_created",
      actorName: "—",
      actorEmail: "",
      organizationName: o.name,
      title: `Organization created`,
      detail: o.name,
    });
    if (o.disabledAt) {
      events.push({
        id: `org-disable-${o.id}`,
        at: o.disabledAt.toISOString(),
        kind: "org_disabled",
        actorName: "—",
        actorEmail: "",
        organizationName: o.name,
        title: `Organization disabled`,
        detail: o.name,
      });
    }
  }

  for (const u of userRows) {
    events.push({
      id: `user-create-${u.id}`,
      at: u.createdAt.toISOString(),
      kind: "user_created",
      actorName: u.name ?? u.email,
      actorEmail: u.email,
      organizationName: "—",
      title: u.isSuperadmin ? "User created (superadmin)" : "User created",
      detail: u.email,
    });
    if (u.disabledAt) {
      events.push({
        id: `user-disable-${u.id}`,
        at: u.disabledAt.toISOString(),
        kind: "user_disabled",
        actorName: u.name ?? u.email,
        actorEmail: u.email,
        organizationName: "—",
        title: "User disabled",
        detail: u.email,
      });
    }
  }

  for (const opp of oppRows) {
    events.push({
      id: `opp-create-${opp.id}`,
      at: opp.createdAt.toISOString(),
      kind: "opportunity_created",
      actorName: "—",
      actorEmail: "",
      organizationName: orgNameById.get(opp.organizationId) ?? "—",
      title: "Opportunity captured",
      detail: opp.title,
    });
  }

  for (const a of oppActs) {
    const actor = a.userId ? userById.get(a.userId) : undefined;
    const opp = oppById.get(a.opportunityId);
    events.push({
      id: `oppact-${a.id}`,
      at: a.createdAt.toISOString(),
      kind: "opportunity_activity",
      actorName: actor?.name ?? actor?.email ?? "—",
      actorEmail: actor?.email ?? "",
      organizationName: opp ? orgNameById.get(opp.organizationId) ?? "—" : "—",
      title: a.kind === "stage_change" ? "Opportunity stage change" : a.title || a.kind,
      detail:
        (opp ? `${opp.title} — ` : "") +
        (a.body || a.title || a.kind),
    });
  }

  for (const p of propRows) {
    const isCreate = p.createdAt.getTime() === p.updatedAt.getTime();
    events.push({
      id: `prop-${isCreate ? "create" : "update"}-${p.id}`,
      at: p.updatedAt.toISOString(),
      kind: isCreate ? "proposal_created" : "proposal_updated",
      actorName: "—",
      actorEmail: "",
      organizationName: orgNameById.get(p.organizationId) ?? "—",
      title: isCreate ? "Proposal created" : `Proposal updated · ${p.stage}`,
      detail: p.title,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events.slice(0, 80);
}
