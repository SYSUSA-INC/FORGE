import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

/**
 * BL-15 Phase B-3b — impersonation write-block.
 *
 * When a super-admin has an active impersonation cookie set, any
 * mutating request is refused at the edge. We detect mutations two ways:
 *   - A `Next-Action` header (Next.js server actions always send one).
 *   - A non-GET/HEAD/OPTIONS method on any path.
 *
 * The only carve-out is `/api/admin/impersonation/end` — clearing the
 * cookie must remain reachable. We rely on cookie presence + path, not
 * DB lookup, because middleware runs at the edge and can't hit Postgres.
 * The DB-level check still happens inside `requireCurrentOrg` so a
 * forged cookie can't actually take over a tenant — at worst it
 * blocks the forger's own writes.
 */
const IMPERSONATION_COOKIE_NAME = "forge_impersonation_session";
const END_IMPERSONATION_PATH = "/api/admin/impersonation/end";

function isImpersonationActive(req: NextRequest): boolean {
  const cookie = req.cookies.get(IMPERSONATION_COOKIE_NAME);
  return !!cookie?.value;
}

function isMutatingRequest(req: NextRequest): boolean {
  if (req.headers.get("next-action")) return true;
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }
  return true;
}

export default auth((req) => {
  // Block mutations while impersonating, except the end-impersonation
  // route which itself is the way out.
  if (isImpersonationActive(req) && isMutatingRequest(req)) {
    if (!req.nextUrl.pathname.startsWith(END_IMPERSONATION_PATH)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Mutations are blocked while impersonating. End impersonation first.",
        },
        { status: 403 },
      );
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
