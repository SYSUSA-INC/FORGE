import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  memberships,
  opportunities,
  proposalReviewAssignments,
  proposalReviews,
  proposalSections,
  proposals,
  type NotificationRecipientStrategy,
  type Role,
} from "@/db/schema";
import { log } from "@/lib/log";
import {
  FORMULA_KINDS,
  type FormulaKind,
} from "@/lib/notification-rules-types";

export type { NotificationRecipientStrategy };

/**
 * BL-13 Phase C — recipient resolver.
 *
 * Translates a rule's `recipient_strategy` + `recipient_config` into
 * a concrete list of user IDs (deduped) that the dispatcher then
 * routes to the configured channels.
 *
 * Three strategies:
 *   - specific_users  → config.userIds (verified as active members)
 *   - role_based      → all users whose membership.role ∈ config.roles
 *   - formula         → relationship-based lookup keyed by
 *                       config.kind + a `payload` carrying the resource id
 *
 * Tenant isolation: every query is filtered by organizationId. The
 * input config is opaque jsonb; bad shapes degrade to an empty
 * recipient list with a warning log rather than throwing — failed
 * recipient resolution should not block the user-facing action.
 */
export async function resolveRecipients(input: {
  organizationId: string;
  strategy: NotificationRecipientStrategy;
  config: Record<string, unknown>;
  payload: Record<string, unknown>;
}): Promise<string[]> {
  const { organizationId, strategy, config, payload } = input;

  try {
    if (strategy === "specific_users") {
      const ids = Array.isArray(config.userIds)
        ? config.userIds.filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length === 0) return [];
      // Filter to current active members; users removed from the org
      // since the rule was created get silently dropped.
      const active = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            inArray(memberships.userId, ids),
          ),
        );
      return dedupe(active.map((r) => r.userId));
    }

    if (strategy === "role_based") {
      const roles = Array.isArray(config.roles)
        ? config.roles.filter((r): r is Role => typeof r === "string")
        : [];
      if (roles.length === 0) return [];
      const rows = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            inArray(memberships.role, roles),
          ),
        );
      return dedupe(rows.map((r) => r.userId));
    }

    if (strategy === "formula") {
      const kind = config.kind;
      if (typeof kind !== "string" || !isFormulaKind(kind)) return [];
      return resolveFormula({ organizationId, kind, payload });
    }

    if (strategy === "mentioned_in_payload") {
      // Reads `payload.mentionedUserIds` (set by dispatchers like the
      // review-comment site). Filters to current active members so a
      // mention of a since-removed user doesn't fire. Config is
      // ignored — the rule just opts in to "whoever was mentioned".
      const raw = (payload as { mentionedUserIds?: unknown }).mentionedUserIds;
      const ids = Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length === 0) return [];
      const active = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            inArray(memberships.userId, ids),
          ),
        );
      return dedupe(active.map((r) => r.userId));
    }

    return [];
  } catch (err) {
    log.error("[resolveRecipients]", "failed", {
      error: err,
      organizationId,
      strategy,
    });
    return [];
  }
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id && id.length > 0)));
}

function isFormulaKind(s: string): s is FormulaKind {
  return (FORMULA_KINDS as readonly string[]).includes(s);
}

/**
 * Formula lookups. Each branch reads a single tenant-scoped row and
 * returns the relevant user-id. Missing id (e.g. proposal owner not
 * assigned) returns an empty list — rule simply doesn't fire.
 */
async function resolveFormula(input: {
  organizationId: string;
  kind: FormulaKind;
  payload: Record<string, unknown>;
}): Promise<string[]> {
  const { organizationId, kind, payload } = input;

  if (kind === "proposal_owner") {
    const proposalId = stringField(payload, "proposalId");
    if (!proposalId) return [];
    const [row] = await db
      .select({ id: proposals.proposalManagerUserId })
      .from(proposals)
      .where(
        and(
          eq(proposals.id, proposalId),
          eq(proposals.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row?.id ? [row.id] : [];
  }

  if (kind === "capture_mgr") {
    const proposalId = stringField(payload, "proposalId");
    if (!proposalId) return [];
    const [row] = await db
      .select({ id: proposals.captureManagerUserId })
      .from(proposals)
      .where(
        and(
          eq(proposals.id, proposalId),
          eq(proposals.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row?.id ? [row.id] : [];
  }

  if (kind === "pricing_lead") {
    const proposalId = stringField(payload, "proposalId");
    if (!proposalId) return [];
    const [row] = await db
      .select({ id: proposals.pricingLeadUserId })
      .from(proposals)
      .where(
        and(
          eq(proposals.id, proposalId),
          eq(proposals.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row?.id ? [row.id] : [];
  }

  if (kind === "opportunity_owner") {
    const opportunityId = stringField(payload, "opportunityId");
    if (!opportunityId) return [];
    const [row] = await db
      .select({ id: opportunities.ownerUserId })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row?.id ? [row.id] : [];
  }

  if (kind === "section_author") {
    const sectionId = stringField(payload, "sectionId");
    if (!sectionId) return [];
    // Join through proposals to enforce org scope — proposalSections
    // doesn't carry organization_id directly.
    const [row] = await db
      .select({ id: proposalSections.authorUserId })
      .from(proposalSections)
      .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
      .where(
        and(
          eq(proposalSections.id, sectionId),
          eq(proposals.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row?.id ? [row.id] : [];
  }

  if (kind === "review_assignee") {
    // Fans out to every reviewer assigned to a specific
    // proposal_review. Used by the `review_completed` and
    // `review_request_pending` default seed rules so the rules engine
    // matches the legacy fan-out. Join through proposalReviews →
    // proposals to enforce org scope — proposalReviewAssignments
    // doesn't carry organization_id directly.
    const reviewId = stringField(payload, "reviewId");
    if (!reviewId) return [];
    const rows = await db
      .select({ id: proposalReviewAssignments.userId })
      .from(proposalReviewAssignments)
      .innerJoin(
        proposalReviews,
        eq(proposalReviews.id, proposalReviewAssignments.reviewId),
      )
      .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
      .where(
        and(
          eq(proposalReviewAssignments.reviewId, reviewId),
          eq(proposals.organizationId, organizationId),
        ),
      );
    return dedupe(rows.map((r) => r.id));
  }

  // Exhaustive: every FormulaKind handled above.
  const _exhaustive: never = kind;
  return _exhaustive;
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
