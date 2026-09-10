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

  // This route is public (auth.config allow-lists it for uptime probes),
  // so it reports reachability only. It never echoes the upstream body
  // or error text, which could carry key-related detail
  // (BL-TENANT-AUDIT 2026-09).
  try {
    const res = await fetch(probeUrl, { cache: "no-store" });
    const bodyText = await res.text();
    let totalRecords: number | null = null;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (typeof parsed === "object" && parsed !== null && "totalRecords" in parsed) {
        const n = (parsed as { totalRecords: unknown }).totalRecords;
        totalRecords = typeof n === "number" ? n : null;
      }
    } catch {
      // Non-JSON upstream body — reachability is all we report.
    }
    return NextResponse.json({
      keyConfigured: true,
      apiReachable: res.ok,
      status: res.status,
      totalRecords,
    });
  } catch {
    return NextResponse.json({
      keyConfigured: true,
      apiReachable: false,
    });
  }
}
