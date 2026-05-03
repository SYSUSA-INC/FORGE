import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchSamGovByUei } from "@/lib/samgov";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Require an authenticated session. SAM.gov entity data is public,
  // but this endpoint had been wide open — anyone on the internet could
  // proxy lookups through us, eating into our rate limit and giving an
  // anonymous reconnaissance surface. Auth-gating closes both.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const uei = url.searchParams.get("uei")?.trim() ?? "";
  const cage = url.searchParams.get("cage")?.trim() ?? "";

  if (!uei && !cage) {
    return NextResponse.json(
      { ok: false, error: "Provide either ?uei= or ?cage=." },
      { status: 400 },
    );
  }

  if (!uei) {
    return NextResponse.json(
      { ok: false, error: "CAGE lookup not supported via this endpoint." },
      { status: 400 },
    );
  }

  const result = await fetchSamGovByUei(uei);
  if (!result.ok) {
    return NextResponse.json(result, {
      status: result.status ?? 502,
      // Cache failures briefly so a flapping upstream doesn't get hammered.
      headers: { "Cache-Control": "private, max-age=60" },
    });
  }
  return NextResponse.json(result, {
    // Cache 1 hour per-user — entity records change infrequently and the
    // primary callers (settings sync, company refresh) don't need real-time
    // freshness. Reduces both our cost and the SAM.gov rate-limit pressure.
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
