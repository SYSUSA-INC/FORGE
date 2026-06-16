import { SignJWT } from "jose";

/**
 * BL-9 Slice 2 — mint short-lived collaboration tokens for the
 * Hocuspocus service (services/collab/).
 *
 * The tokens are HS256 JWTs signed with the same `AUTH_SECRET` that
 * NextAuth uses for its own sessions. The Hocuspocus
 * `onAuthenticate` hook (services/collab/src/auth.ts) verifies the
 * signature, enforces the 15-minute expiry, and pulls the
 * `userId` / `organizationId` claims to scope the connection.
 *
 * Claim shape — kept in sync with `verifyCollabToken` in
 * services/collab/:
 *   sub    — userId
 *   orgId  — organizationId
 *   email  — user email (presence label fallback)
 *   name   — display name (presence label)
 *   iat    — issued-at (standard)
 *   exp    — issued-at + 15 minutes (standard, enforced by jose)
 *
 * Why short-lived: revocation on session end. If a user signs out or
 * is removed from an org, their next collab connection attempt fails
 * within 15 minutes — we don't need a server-side revocation list.
 * Clients refresh by re-hitting /api/collab/token before expiry.
 */

const COLLAB_TOKEN_TTL_SECONDS = 15 * 60;

export async function mintCollabToken(input: {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
}): Promise<{ token: string; expiresAt: number }> {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) {
    // Match NextAuth's behavior: a missing AUTH_SECRET is a deployment
    // misconfiguration, not a runtime user error. Throwing surfaces it
    // loudly in the Vercel logs rather than minting useless tokens.
    throw new Error("AUTH_SECRET is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + COLLAB_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({
    orgId: input.organizationId,
    email: input.email,
    name: input.displayName,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));

  return { token, expiresAt: exp * 1000 };
}
