import { jwtVerify } from "jose";

/**
 * BL-9 Slice 1 — verify a NextAuth-issued JWT and extract the
 * `userId` + `organizationId` claims that scope the collab session.
 *
 * NextAuth signs JWTs with HS256 against the shared `AUTH_SECRET`
 * (also used by the Next app for its own session cookies). We do
 * symmetric verification here using `jose`, the same library NextAuth
 * uses internally — guarantees we accept exactly the tokens NextAuth
 * issues, no more, no less.
 *
 * Token surface (claims FORGE puts on the JWT — see auth.config.ts in
 * the Next app):
 *   - `sub`      : userId
 *   - `email`    : user email
 *   - `name`     : display name (used for presence labels)
 *   - `orgId`    : currently-selected organization
 *   - `exp`      : standard JWT expiry; jose enforces this for us
 *
 * If any required claim is missing, or the signature/expiry is bad,
 * the function throws — the caller turns that into a `closeFrame`
 * 4401 and the client retries with a fresh token.
 */

export type CollabClaims = {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
};

export async function verifyCollabToken(
  token: string,
  secret: string,
): Promise<CollabClaims> {
  if (!token) throw new Error("missing token");
  if (!secret) throw new Error("AUTH_SECRET not configured");

  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, {
    // NextAuth defaults; tighten if FORGE auth config diverges.
    algorithms: ["HS256"],
  });

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  const organizationId =
    typeof payload.orgId === "string" ? payload.orgId : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  const displayName =
    typeof payload.name === "string" && payload.name.length > 0
      ? payload.name
      : email || userId;

  if (!userId) throw new Error("token missing `sub` claim");
  if (!organizationId) throw new Error("token missing `orgId` claim");
  return { userId, organizationId, email, displayName };
}

/**
 * Doc-name shape for Slice 1: `section/<proposalSectionId>`. Future
 * slices add `section_template/<id>`, `solicitation/<id>`, etc. The
 * leading namespace is what scopes the row in `yjs_doc` — the
 * caller (Hocuspocus onAuthenticate) refuses unknown namespaces so a
 * malicious client can't open arbitrary doc names.
 */
const KNOWN_NAMESPACES = new Set(["section"]);

export function parseDocName(
  docName: string,
): { namespace: string; entityId: string } | null {
  const slash = docName.indexOf("/");
  if (slash <= 0 || slash === docName.length - 1) return null;
  const namespace = docName.slice(0, slash);
  const entityId = docName.slice(slash + 1);
  if (!KNOWN_NAMESPACES.has(namespace)) return null;
  // Basic shape check — UUID-ish. We don't require strict v4 because
  // some legacy entity ids predate the UUID-only policy.
  if (!/^[\w-]{8,}$/.test(entityId)) return null;
  return { namespace, entityId };
}
