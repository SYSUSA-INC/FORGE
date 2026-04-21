import { NextResponse } from "next/server";
import { fetchSamGovByUei } from "@/lib/samgov";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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
    return NextResponse.json(result, { status: result.status ?? 502 });
  }
  return NextResponse.json(result);
}
