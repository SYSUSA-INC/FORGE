/**
 * BL-16 apiAccess — the read-only /api/v1 endpoints. `handleApiV1` is the
 * one wrapper every route uses: token check, JSON errors, a read entry in
 * the workspace's audit log for each answered request, no caching. The
 * reads below are scoped to the token's workspace.
 */
import "server-only";

import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { opportunities, opportunityStageEnum, proposals, proposalSections, proposalStageEnum } from "@/db/schema";
import { recordRead } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { authenticateApiRequest, type ApiCaller } from "@/lib/api-tokens";
import {
  apiOpportunity,
  apiProposal,
  apiSection,
  isUuid,
  pageOf,
  parseListParams,
  type ListCursor,
} from "@/lib/api-tokens-logic";

export type ApiV1Result = { status: number; body: Record<string, unknown>; count?: number };

const NO_STORE = { "Cache-Control": "no-store" };

export async function handleApiV1(
  req: Request,
  endpoint: string,
  run: (caller: ApiCaller, url: URL) => Promise<ApiV1Result>,
): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(req);
    if (!auth.ok) {
      const headers: Record<string, string> = { ...NO_STORE };
      if (auth.retryAfter) headers["Retry-After"] = String(auth.retryAfter);
      if (auth.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="forge"';
      return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }
    const { caller } = auth;
    const url = new URL(req.url);
    const result = await run(caller, url);
    if (result.status === 200) {
      await recordRead({
        organizationId: caller.organizationId,
        actor: { userId: null, email: `API token ${caller.tokenPrefix}… (${caller.tokenName})` },
        action: "api.v1.read",
        resourceType: "api",
        resourceId: endpoint,
        metadata: { tokenId: caller.tokenId, path: url.pathname, query: url.search, count: result.count ?? 1 },
      });
    }
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
  } catch (err) {
    log.error("[api-v1]", "unhandled error", { error: err, endpoint });
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500, headers: NO_STORE });
  }
}

const notFound = (what: string): ApiV1Result => ({ status: 404, body: { error: `No ${what} with that id in this workspace.` } });
const badRequest = (error: string): ApiV1Result => ({ status: 400, body: { error } });

/**
 * Newest change first. Postgres keeps microseconds and JavaScript dates
 * keep milliseconds, so order and page on the millisecond-truncated
 * timestamp — otherwise rows inside the same millisecond as a page's last
 * row could fall between pages.
 */
function keyset(updatedAt: AnyPgColumn, id: AnyPgColumn, cursor: ListCursor | null) {
  const ms = sql`date_trunc('milliseconds', ${updatedAt})`;
  const after = cursor ? sql`(${ms}, ${id}) < (${cursor.updatedAt.toISOString()}::timestamp, ${cursor.id}::uuid)` : undefined;
  return { after, order: [desc(ms), desc(id)] };
}

export function apiMe(caller: ApiCaller): ApiV1Result {
  return {
    status: 200,
    body: {
      organization: { id: caller.organizationId, name: caller.organizationName },
      token: { name: caller.tokenName, prefix: caller.tokenPrefix, expiresAt: caller.expiresAt?.toISOString() ?? null },
    },
  };
}

const opportunityColumns = {
  id: opportunities.id,
  title: opportunities.title,
  agency: opportunities.agency,
  office: opportunities.office,
  stage: opportunities.stage,
  solicitationNumber: opportunities.solicitationNumber,
  noticeId: opportunities.noticeId,
  naicsCode: opportunities.naicsCode,
  pscCode: opportunities.pscCode,
  setAside: opportunities.setAside,
  contractType: opportunities.contractType,
  placeOfPerformance: opportunities.placeOfPerformance,
  incumbent: opportunities.incumbent,
  valueLow: opportunities.valueLow,
  valueHigh: opportunities.valueHigh,
  pWin: opportunities.pWin,
  releaseDate: opportunities.releaseDate,
  responseDueDate: opportunities.responseDueDate,
  awardDate: opportunities.awardDate,
  createdAt: opportunities.createdAt,
  updatedAt: opportunities.updatedAt,
};

export async function apiListOpportunities(organizationId: string, url: URL): Promise<ApiV1Result> {
  const params = parseListParams(url.searchParams, opportunityStageEnum.enumValues);
  if (!params.ok) return badRequest(params.error);
  const { limit, cursor, updatedSince, stage } = params.value;
  const page = keyset(opportunities.updatedAt, opportunities.id, cursor);
  const rows = await db
    .select(opportunityColumns)
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        stage ? eq(opportunities.stage, stage as (typeof opportunityStageEnum.enumValues)[number]) : undefined,
        updatedSince ? gte(opportunities.updatedAt, updatedSince) : undefined,
        page.after,
      ),
    )
    .orderBy(...page.order)
    .limit(limit + 1);
  const { items, nextCursor } = pageOf(rows, limit);
  return { status: 200, body: { data: items.map(apiOpportunity), nextCursor }, count: items.length };
}

export async function apiGetOpportunity(organizationId: string, id: string): Promise<ApiV1Result> {
  if (!isUuid(id)) return notFound("opportunity");
  const [row] = await db
    .select({ ...opportunityColumns, description: opportunities.description })
    .from(opportunities)
    .where(and(eq(opportunities.id, id), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!row) return notFound("opportunity");
  return { status: 200, body: { data: { ...apiOpportunity(row), description: row.description } } };
}

const proposalColumns = {
  id: proposals.id,
  opportunityId: proposals.opportunityId,
  title: proposals.title,
  stage: proposals.stage,
  submittedAt: proposals.submittedAt,
  createdAt: proposals.createdAt,
  updatedAt: proposals.updatedAt,
};

export async function apiListProposals(organizationId: string, url: URL): Promise<ApiV1Result> {
  const params = parseListParams(url.searchParams, proposalStageEnum.enumValues);
  if (!params.ok) return badRequest(params.error);
  const { limit, cursor, updatedSince, stage } = params.value;
  const page = keyset(proposals.updatedAt, proposals.id, cursor);
  const rows = await db
    .select(proposalColumns)
    .from(proposals)
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        stage ? eq(proposals.stage, stage as (typeof proposalStageEnum.enumValues)[number]) : undefined,
        updatedSince ? gte(proposals.updatedAt, updatedSince) : undefined,
        page.after,
      ),
    )
    .orderBy(...page.order)
    .limit(limit + 1);
  const { items, nextCursor } = pageOf(rows, limit);
  return { status: 200, body: { data: items.map(apiProposal), nextCursor }, count: items.length };
}

/** The proposal with its section outline (titles, status, word counts — not the text). */
export async function apiGetProposal(organizationId: string, id: string): Promise<ApiV1Result> {
  if (!isUuid(id)) return notFound("proposal");
  const [row] = await db
    .select(proposalColumns)
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) return notFound("proposal");
  const sections = await db
    .select({
      id: proposalSections.id,
      kind: proposalSections.kind,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
      status: proposalSections.status,
      wordCount: proposalSections.wordCount,
      pageLimit: proposalSections.pageLimit,
      updatedAt: proposalSections.updatedAt,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.proposalId, id), eq(proposals.organizationId, organizationId)))
    .orderBy(asc(proposalSections.ordering));
  return { status: 200, body: { data: { ...apiProposal(row), sections: sections.map(apiSection) } } };
}
