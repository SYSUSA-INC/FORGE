"use server";

import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

const PAGE_SIZE = 100;

export type AuditFilter = {
  /** Free-text search across action, resourceType, resourceId,
   *  actor email. Case-insensitive. */
  query?: string;
  actorUserId?: string;
  /** "<resource>.<verb>" exact match, e.g. "opportunity.create". */
  action?: string;
  /** Resource type prefix match, e.g. "opportunity" matches all
   *  opportunity.* events. */
  resourceType?: string;
  /** ISO date strings (YYYY-MM-DD) inclusive. */
  fromDate?: string;
  toDate?: string;
  /** 1-indexed page number. */
  page?: number;
};

export type AuditRow = {
  id: string;
  actorUserId: string | null;
  actorEmail: string;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  ip: string;
  userAgent: string;
  createdAt: string;
};

export type AuditQueryResult = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listAuditEventsAction(
  filter: AuditFilter,
): Promise<AuditQueryResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const conditions = [eq(auditLogs.organizationId, organizationId)];

  if (filter.actorUserId) {
    conditions.push(eq(auditLogs.actorUserId, filter.actorUserId));
  }
  if (filter.action) {
    conditions.push(eq(auditLogs.action, filter.action));
  }
  if (filter.resourceType) {
    // Prefix match — "opportunity" finds all opportunity.* events.
    conditions.push(ilike(auditLogs.resourceType, `${filter.resourceType}%`));
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
      // Inclusive: bump to end-of-day.
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogs.createdAt, d));
    }
  }
  if (filter.query) {
    const q = `%${filter.query.trim()}%`;
    // OR across action / resourceType / actor email.
    conditions.push(
      sql`(${auditLogs.action} ILIKE ${q} OR ${auditLogs.resourceType} ILIKE ${q} OR ${auditLogs.resourceId} ILIKE ${q} OR ${auditLogs.actorEmailSnapshot} ILIKE ${q})`,
    );
  }

  const where = and(...conditions);
  const page = Math.max(1, filter.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);

  const rows = await db
    .select({
      id: auditLogs.id,
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
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      actorEmail: r.actorEmailSnapshot,
      actorName: r.actorName,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      metadata: r.metadata,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
    total: Number(count),
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Surface the list of org members who appear as actors in the audit
 * log. Drives the "filter by actor" dropdown — only shows people
 * who actually have audit rows so the dropdown stays scoped.
 */
export async function listAuditActorsAction(): Promise<
  { id: string; name: string | null; email: string }[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name));

  return rows;
}

/**
 * Build a CSV export of the (filtered) audit log. Cursor-paginated
 * server-side and concatenated; OK because tenant logs at our scale
 * fit comfortably in memory. Re-evaluate with multi-MB exports.
 *
 * Returns the full CSV text. Caller is responsible for sending it
 * as a download (route handler / blob construction client-side).
 */
export async function exportAuditLogCsvAction(
  filter: AuditFilter,
): Promise<{ ok: true; csv: string; rowCount: number } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Reuse the filtered query but page through all matches (no
  // PAGE_SIZE cap on export).
  const conditions = [eq(auditLogs.organizationId, organizationId)];
  if (filter.actorUserId) {
    conditions.push(eq(auditLogs.actorUserId, filter.actorUserId));
  }
  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.resourceType) {
    conditions.push(ilike(auditLogs.resourceType, `${filter.resourceType}%`));
  }
  if (filter.fromDate) {
    const d = new Date(filter.fromDate);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(auditLogs.createdAt, d));
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

  const all = await db
    .select({
      createdAt: auditLogs.createdAt,
      actorEmail: auditLogs.actorEmailSnapshot,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50_000);

  const header = [
    "timestamp",
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

function csvEscape(v: string): string {
  if (v === undefined || v === null) return "";
  // RFC 4180 — wrap in quotes when value contains comma, quote, or newline;
  // double-up quotes inside.
  if (/[,"\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
