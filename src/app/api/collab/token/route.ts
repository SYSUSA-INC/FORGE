import { NextResponse, type NextRequest } from "next/server";
import { mintCollabToken } from "@/lib/collab-token";
import { requireCurrentOrg } from "@/lib/auth-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BL-9 Slice 2 — mint a short-lived collab token for the signed-in
 * user. The browser editor (services/collab/ client side) hits this
 * endpoint before opening the WebSocket and then re-hits it before
 * the token expires (default 15 min).
 *
 * Auth gate: `requireCurrentOrg` redirects unauthenticated visitors,
 * so by the time we reach the body we have a usable session + an
 * active organizationId. The mint helper bakes both into the JWT.
 *
 * Doc-name scoping: this endpoint does NOT verify a specific doc_name
 * because every collab document must already pass the Hocuspocus
 * `onAuthenticate` hook, which double-checks the doc's
 * organization_id against the token's `orgId` claim. Issuing tokens
 * at the user level (rather than per-doc) lets a single token serve a
 * multi-doc session and keeps this endpoint cheap.
 *
 * Returns:
 *   200 { token, expiresAt }  — usable, expiresAt is milliseconds since
 *                               epoch so the client can schedule a
 *                               pre-expiry refresh
 *   401                       — implicitly via requireCurrentOrg's
 *                               redirect; clients see a 307 → /sign-in
 *   500 { error }             — only on AUTH_SECRET misconfig
 */
export async function POST(_req: NextRequest) {
  const { user, organizationId } = await requireCurrentOrg();

  try {
    const { token, expiresAt } = await mintCollabToken({
      userId: user.id,
      organizationId,
      email: user.email || "",
      displayName: user.name || user.email || user.id,
    });
    return NextResponse.json({ token, expiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "mint failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
