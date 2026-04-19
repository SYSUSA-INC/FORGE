import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAM_BASE = "https://api.sam.gov/entity-information/v4/entities";

export async function GET() {
  const key = process.env.SAMGOV_API_KEY;
  const keyConfigured = Boolean(key && key.length > 0);

  if (!keyConfigured) {
    return NextResponse.json({
      keyConfigured: false,
      apiReachable: false,
      message:
        "SAMGOV_API_KEY is not set in this environment. Add it in Vercel → Settings → Environment Variables and redeploy.",
    });
  }

  const probeUrl = `${SAM_BASE}?api_key=${encodeURIComponent(key!)}&samRegistered=Yes&registrationStatus=A&page=0&size=1`;

  try {
    const res = await fetch(probeUrl, { cache: "no-store" });
    const bodyText = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = bodyText.slice(0, 400);
    }
    const totalRecords =
      typeof parsed === "object" && parsed !== null && "totalRecords" in parsed
        ? (parsed as { totalRecords: number }).totalRecords
        : null;
    return NextResponse.json({
      keyConfigured: true,
      apiReachable: res.ok,
      status: res.status,
      totalRecords,
      samplePreview: res.ok ? null : parsed,
    });
  } catch (err) {
    return NextResponse.json({
      keyConfigured: true,
      apiReachable: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
