import { NextResponse } from "next/server";
import { endImpersonationAction } from "@/app/(app)/admin/orgs/[id]/impersonation-actions";

/**
 * BL-15 Phase B-3b — end-impersonation endpoint.
 *
 * Lives as an API route (rather than a server action) so the middleware
 * write-block can recognise it by path and let it through even when an
 * impersonation cookie is set. Every other server action and route is
 * refused while impersonation is active.
 *
 * Returns JSON; the banner button on the layout POSTs to this endpoint
 * with `credentials: include` so the cookie travels.
 */
export async function POST(): Promise<NextResponse> {
  const res = await endImpersonationAction();
  if (!res.ok) {
    return NextResponse.json(res, { status: 400 });
  }
  return NextResponse.json(res);
}
