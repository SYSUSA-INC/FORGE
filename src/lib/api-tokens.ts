/**
 * BL-16 apiAccess — a workspace's API tokens: create (the plain token is
 * returned once, only its SHA-256 is kept), list, revoke, and the check
 * every /api/v1 request goes through. Tokens belong to the workspace,
 * not to the admin who made them.
 */
import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, memberships, organizations, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureFeature, FeatureGateError } from "@/lib/subscription-gates";
import {
  API_RATE_LIMIT,
  API_TOKEN_PREFIX,
  MAX_ACTIVE_TOKENS,
  shouldTouchLastUsed,
  tokenDisplayPrefix,
  tokenExpiry,
  tokenFromAuthorization,
  tokenState,
  validateTokenName,
  type TokenState,
} from "@/lib/api-tokens-logic";

type Actor = { userId: string; email: string | null };

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** Why the workspace's plan refuses API access, or null when it allows it. */
export async function apiAccessRefusal(organizationId: string): Promise<string | null> {
  try {
    await ensureFeature(organizationId, "apiAccess");
    return null;
  } catch (err) {
    if (err instanceof FeatureGateError) {
      return "API access isn't included in this workspace's plan. An admin can add it under Settings → Billing.";
    }
    throw err;
  }
}

export type ApiTokenListRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  state: TokenState;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdBy: string;
  /** Who revoked it: a member's name, "FORGE support" for a platform admin, or null while not revoked. */
  revokedBy: string | null;
};

export const PLATFORM_REVOKER_LABEL = "FORGE support";

export async function listApiTokens(organizationId: string): Promise<ApiTokenListRow[]> {
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      revokedByUserId: apiTokens.revokedByUserId,
      creatorName: users.name,
      creatorEmail: users.email,
    })
    .from(apiTokens)
    .leftJoin(users, eq(users.id, apiTokens.createdByUserId))
    .where(eq(apiTokens.organizationId, organizationId))
    .orderBy(desc(apiTokens.createdAt));

  // A platform admin who isn't a member of this workspace shows as FORGE support.
  const revokerIds = [...new Set(rows.map((r) => r.revokedByUserId).filter((id): id is string => !!id))];
  const revokers = revokerIds.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, isSuperadmin: users.isSuperadmin, memberId: memberships.userId })
        .from(users)
        .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, organizationId)))
        .where(inArray(users.id, revokerIds))
    : [];
  const revokerLabel = new Map(
    revokers.map((u) => [u.id, u.isSuperadmin && !u.memberId ? PLATFORM_REVOKER_LABEL : u.name || u.email || "A former member"]),
  );

  const now = new Date();
  return rows.map(({ creatorName, creatorEmail, revokedByUserId, ...r }) => ({
    ...r,
    state: tokenState(r, now),
    createdBy: creatorName || creatorEmail || "A former member",
    revokedBy: r.revokedAt ? (revokedByUserId ? revokerLabel.get(revokedByUserId) ?? "A former member" : "A former member") : null,
  }));
}

export async function createApiToken(input: {
  organizationId: string;
  name: unknown;
  expiresInDays: unknown;
  actor: Actor;
}): Promise<{ ok: true; id: string; token: string } | { ok: false; error: string }> {
  const { organizationId, actor } = input;
  const name = validateTokenName(input.name);
  if (!name.ok) return name;
  const now = new Date();
  const expiresAt = tokenExpiry(input.expiresInDays, now);
  if (expiresAt === undefined) return { ok: false, error: "Pick one of the offered lifetimes." };

  const refusal = await apiAccessRefusal(organizationId);
  if (refusal) return { ok: false, error: refusal };

  const [live] = await db
    .select({ n: count() })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.organizationId, organizationId),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    );
  if ((live?.n ?? 0) >= MAX_ACTIVE_TOKENS) {
    return { ok: false, error: `This workspace already has ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you no longer use first.` };
  }

  const token = newApiToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      organizationId,
      name: name.value,
      tokenPrefix: tokenDisplayPrefix(token),
      tokenHash: hashApiToken(token),
      createdByUserId: actor.userId,
      expiresAt,
    })
    .returning({ id: apiTokens.id });
  if (!row) return { ok: false, error: "The token could not be saved. Try again." };

  await recordAudit({
    organizationId,
    actor,
    action: "api_token.create",
    resourceType: "api_token",
    resourceId: row.id,
    metadata: { name: name.value, prefix: tokenDisplayPrefix(token), expiresAt: expiresAt?.toISOString() ?? null },
  });
  return { ok: true, id: row.id, token };
}

/**
 * Revoke one token. `platformReason` is set when a platform admin revokes
 * from /admin/orgs/[id]; it goes into the workspace's audit log.
 */
export async function revokeApiToken(input: {
  organizationId: string;
  tokenId: string;
  actor: Actor;
  platformReason?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, tokenId, actor, platformReason } = input;
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date(), revokedByUserId: actor.userId })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.organizationId, organizationId), isNull(apiTokens.revokedAt)))
    .returning({ name: apiTokens.name, prefix: apiTokens.tokenPrefix });
  if (!row) return { ok: false, error: "That token is already revoked or no longer exists." };
  await recordAudit({
    organizationId,
    actor,
    action: "api_token.revoke",
    resourceType: "api_token",
    resourceId: tokenId,
    metadata: { name: row.name, prefix: row.prefix, ...(platformReason ? { byPlatformAdmin: true, reason: platformReason } : {}) },
  });
  return { ok: true };
}

/**
 * Platform admin — revoke every active token of a workspace at once (a
 * leaked token, a compromised integration). One audit row lists them.
 */
export async function revokeAllApiTokens(input: {
  organizationId: string;
  actor: Actor;
  reason: string;
}): Promise<{ ok: true; revoked: number }> {
  const { organizationId, actor, reason } = input;
  const now = new Date();
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: now, revokedByUserId: actor.userId })
    .where(
      and(
        eq(apiTokens.organizationId, organizationId),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .returning({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.tokenPrefix });
  if (rows.length > 0) {
    await recordAudit({
      organizationId,
      actor,
      action: "api_token.revoke_all",
      resourceType: "api_token",
      resourceId: organizationId,
      metadata: { byPlatformAdmin: true, reason, count: rows.length, tokens: rows.map((r) => `${r.prefix} (${r.name})`) },
    });
  }
  return { ok: true, revoked: rows.length };
}

export type ApiCaller = {
  organizationId: string;
  organizationName: string;
  tokenId: string;
  tokenName: string;
  tokenPrefix: string;
  expiresAt: Date | null;
};

export type ApiAuthResult =
  | { ok: true; caller: ApiCaller }
  | { ok: false; status: 401 | 403 | 429; error: string; retryAfter?: number };

/**
 * The gate for every /api/v1 request. The token is the credential: its
 * hash resolves the workspace, so this lookup is the one place that reads
 * api_token without an organization filter. Then, in order: revoked or
 * expired → 401, disabled workspace → 403, over the per-token rate limit
 * → 429, plan without API access → 403.
 */
export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult> {
  const token = tokenFromAuthorization(req.headers.get("authorization"));
  if (!token) return { ok: false, status: 401, error: "Send your API token as: Authorization: Bearer forge_…" };

  const [row] = await db
    .select({
      id: apiTokens.id,
      organizationId: apiTokens.organizationId,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      lastUsedAt: apiTokens.lastUsedAt,
      organizationName: organizations.name,
      disabledAt: organizations.disabledAt,
    })
    .from(apiTokens)
    .innerJoin(organizations, eq(organizations.id, apiTokens.organizationId))
    .where(eq(apiTokens.tokenHash, hashApiToken(token)))
    .limit(1);
  if (!row) return { ok: false, status: 401, error: "This API token isn't recognised." };

  const now = new Date();
  const state = tokenState(row, now);
  if (state === "revoked") return { ok: false, status: 401, error: "This API token was revoked." };
  if (state === "expired") return { ok: false, status: 401, error: "This API token has expired." };
  if (row.disabledAt) return { ok: false, status: 403, error: "This workspace is disabled." };

  const limit = await enforceRateLimit({ key: `api-v1:token:${row.id}`, ...API_RATE_LIMIT });
  if (!limit.ok) {
    return { ok: false, status: 429, error: `Rate limit is ${API_RATE_LIMIT.limit} requests a minute per token.`, retryAfter: limit.retryAfter };
  }

  const refusal = await apiAccessRefusal(row.organizationId);
  if (refusal) return { ok: false, status: 403, error: refusal };

  if (shouldTouchLastUsed(row.lastUsedAt, now)) {
    try {
      await db
        .update(apiTokens)
        .set({ lastUsedAt: now })
        .where(and(eq(apiTokens.id, row.id), eq(apiTokens.organizationId, row.organizationId)));
    } catch (err) {
      log.warn("[api-tokens]", "could not record last use", { error: err, tokenId: row.id });
    }
  }

  return {
    ok: true,
    caller: {
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      tokenId: row.id,
      tokenName: row.name,
      tokenPrefix: row.tokenPrefix,
      expiresAt: row.expiresAt,
    },
  };
}
