/**
 * BL-AI-STREAMING — tenant context for route handlers.
 *
 * `requireAuth` / `requireCurrentOrg` call `redirect()` on failure, which
 * is right for pages and server actions but wrong for a fetch-driven API
 * route: the client would follow a 307 to the sign-in HTML. This wrapper
 * catches the redirect and returns a JSON 401 instead, so callers get a
 * clean error they can render.
 *
 * Everything else (impersonation override, superadmin handling) is
 * exactly `requireCurrentOrg`, so tenant scoping behaves identically to
 * the server-action path.
 */
import "server-only";

import { NextResponse } from "next/server";
import { requireCurrentOrg, type CurrentOrgContext } from "@/lib/auth-helpers";

export type ApiTenantResult =
  | { ok: true; ctx: CurrentOrgContext }
  | { ok: false; response: NextResponse };

function isNextRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function requireApiTenant(): Promise<ApiTenantResult> {
  try {
    const ctx = await requireCurrentOrg();
    return { ok: true, ctx };
  } catch (err) {
    if (isNextRedirect(err)) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: "Sign in to continue." },
          { status: 401 },
        ),
      };
    }
    throw err;
  }
}
