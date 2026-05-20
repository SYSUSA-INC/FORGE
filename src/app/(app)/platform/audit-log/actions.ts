"use server";

import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, organizations, users } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { safeQuery } from "@/lib/schema-resilience";

/**
 * BL-18 — super-admin cross-tenant view of the BL-12 audit log.
 *
 * These actions deliberately skip the per-tenant scope filter that
 * `/audit-log` enforces — super-admins see every row across every
 * tenant. Each export uses `requireSuperadmin()` as the only gate;
 * a non-superadmin call will throw before any query runs.
 *
 * Reads from the real `audit_log` table written by `recordAudit` /
 * `recordRead` — actor IPs, user agents, structured metadata, and
 * read-vs-mutation categorization. The legacy synthesized
 * `AuditLogTab` under `/admin` was retired in BL-18-cleanup; this
 * is now the only super-admin audit surface.
 */

const PAGE_SIZE = 100;

export type PlatformAuditFilter = {
  query?: string;
  organizationId?: string;
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  /** "read" | "mutation" | undefined (both). Distinguishes the two
   *  by checking `metadata->>'category'` — set to "read" by
   *  `recordRead`, absent for `recordAudit`. */
  category?: "read" | "mutation";
  fromDate?: string;
  toDate?: string;
  page?: number;
};

export type PlatformAuditRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  actorUserId: string | null;
  actorEmail: string;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  category: "read" | "mutation";
  metadata: Record<string, unknown>;
  ip: string;
  userAgent: string;
  createdAt: string;
};

export type PlatformAuditQueryResult = {
  rows: PlatformAuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listPlatformAuditEventsAction(
  filter: PlatformAuditFilter,
): Promise<PlatformAuditQueryResult> {
  await requireSuperadmin();

  const where = buildWhere(filter);
  const page = Math.max(1, filter.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const countResult = await safeQuery(
    () =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(where),
    [{ count: 0 }],
    { tag: "platform.auditLogs.count" },
  );
  const total = countResult[0]?.count ?? 0;

  type Row = {
    id: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    actorUserId: string | null;
    actorEmailSnapshot: string;
    actorName: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
    ip: string;
    userAgent: string;
    createdAt: Date;
  };
  const rows = await safeQuery<Row[]>(
    () =>
      db
        .select({
          id: auditLogs.id,
          organizationId: auditLogs.organizationId,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
          actorUserId: auditLogs.actorUserId,
          actorEmailSnapshot: auditLogs.actorEmailSnapshot,
          actorName: users.name,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          metadata: auditLogs.metadata,
          ip: auditLogs.ip,
          userAgent: auditLogs.userAgent,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .innerJoin(
          organizations,
          eq(organizations.id, auditLogs.organizationId),
        )
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset),
    [],
    { tag: "platform.auditLogs.list" },
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      organizationSlug: r.organizationSlug,
      actorUserId: r.actorUserId,
      actorEmail: r.actorEmailSnapshot,
      actorName: r.actorName,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      category:
        (r.metadata as { category?: unknown })?.category === "read"
          ? "read"
          : "mutation",
      metadata: r.metadata,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
    total: Number(total),
    page,
    pageSize: PAGE_SIZE,
  };
}

export type PlatformTenantSummary = {
  id: string;
  name: string;
  slug: string;
  totalEvents: number;
  lastEventAt: string | null;
};

/**
 * Tenant filter dropdown: only orgs that have at least one audit
 * row appear, so the dropdown stays scoped. The aggregate doubles
 * as the "group by tenant" anomaly view — sorted descending by
 * event volume.
 */
export async function listPlatformAuditTenantsAction(): Promise<
  PlatformTenantSummary[]
> {
  await requireSuperadmin();

  const rows = await safeQuery(
    () =>
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          totalEvents: sql<number>`count(${auditLogs.id})::int`,
          lastEventAt: sql<Date | null>`max(${auditLogs.createdAt})`,
        })
        .from(organizations)
        .innerJoin(
          auditLogs,
          eq(auditLogs.organizationId, organizations.id),
        )
        .groupBy(organizations.id)
        .orderBy(desc(sql`count(${auditLogs.id})`)),
    [],
    { tag: "platform.auditLogs.tenants" },
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    totalEvents: Number(r.totalEvents),
    lastEventAt: r.lastEventAt ? r.lastEventAt.toISOString() : null,
  }));
}

export type PlatformActorSummary = {
  id: string;
  name: string | null;
  email: string;
  organizationName: string | null;
};

/**
 * Actor filter dropdown: distinct users who appear in the audit log.
 * Skips rows where actorUserId is null (token-scoped public review
 * submissions, etc.) since those can't be selected as a filter; the
 * UI falls back to text search for those cases.
 */
export async function listPlatformAuditActorsAction(): Promise<
  PlatformActorSummary[]
> {
  await requireSuperadmin();

  const actorIds = await safeQuery(
    () =>
      db
        .selectDistinct({ id: auditLogs.actorUserId })
        .from(auditLogs)
        .where(sql`${auditLogs.actorUserId} IS NOT NULL`),
    [],
    { tag: "platform.auditLogs.actorIds" },
  );

  const ids = actorIds
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      organizationName: organizations.name,
    })
    .from(users)
    .leftJoin(memberships, eq(memberships.userId, users.id))
    .leftJoin(
      organizations,
      eq(organizations.id, memberships.organizationId),
    )
    .where(inArray(users.id, ids))
    .orderBy(asc(users.email));

  // Dedupe in case a user has multiple memberships — keep the first
  // (alphabetically earliest by email).
  const seen = new Set<string>();
  const result: PlatformActorSummary[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    result.push({
      id: r.id,
      name: r.name,
      email: r.email,
      organizationName: r.organizationName,
    });
  }
  return result;
}

export async function exportPlatformAuditLogCsvAction(
  filter: PlatformAuditFilter,
): Promise<
  { ok: true; csv: string; rowCount: number } | { ok: false; error: string }
> {
  await requireSuperadmin();

  const where = buildWhere(filter);

  const all = await db
    .select({
      createdAt: auditLogs.createdAt,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      actorEmail: auditLogs.actorEmailSnapshot,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .innerJoin(organizations, eq(organizations.id, auditLogs.organizationId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(50_000);

  const header = [
    "timestamp",
    "tenant",
    "tenant_slug",
    "actor_email",
    "action",
    "resource_type",
    "resource_id",
    "ip",
    "user_agent",
    "metadata",
  ];
  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const r of all) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.organizationName,
        r.organizationSlug,
        r.actorEmail,
        r.action,
        r.resourceType,
        r.resourceId,
        r.ip,
        r.userAgent,
        JSON.stringify(r.metadata ?? {}),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return { ok: true, csv: lines.join("\n"), rowCount: all.length };
}

function buildWhere(filter: PlatformAuditFilter) {
  const conditions = [];
  if (filter.organizationId) {
    conditions.push(eq(auditLogs.organizationId, filter.organizationId));
  }
  if (filter.actorUserId) {
    conditions.push(eq(auditLogs.actorUserId, filter.actorUserId));
  }
  if (filter.action) {
    conditions.push(eq(auditLogs.action, filter.action));
  }
  if (filter.resourceType) {
    conditions.push(ilike(auditLogs.resourceType, `${filter.resourceType}%`));
  }
  if (filter.category === "read") {
    conditions.push(sql`${auditLogs.metadata}->>'category' = 'read'`);
  } else if (filter.category === "mutation") {
    conditions.push(
      sql`(${auditLogs.metadata}->>'category' IS NULL OR ${auditLogs.metadata}->>'category' != 'read')`,
    );
  }
  if (filter.fromDate) {
    const d = new Date(filter.fromDate);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(gte(auditLogs.createdAt, d));
    }
  }
  if (filter.toDate) {
    const d = new Date(filter.toDate);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogs.createdAt, d));
    }
  }
  if (filter.query) {
    const q = `%${filter.query.trim()}%`;
    conditions.push(
      sql`(${auditLogs.action} ILIKE ${q} OR ${auditLogs.resourceType} ILIKE ${q} OR ${auditLogs.resourceId} ILIKE ${q} OR ${auditLogs.actorEmailSnapshot} ILIKE ${q})`,
    );
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function csvEscape(v: string): string {
  if (v === undefined || v === null) return "";
  if (/[,"\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
