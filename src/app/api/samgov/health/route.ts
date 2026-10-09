import { NextResponse } from "next/server";
import { samGetText } from "@/lib/samgov";
import { platformSamCredential } from "@/lib/samgov-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAM_BASE = "https://api.sam.gov/entity-information/v4/entities";

export async function GET() {
  // FORGE's shared key only: this route is public, so it never resolves a company's key.
  const cred = platformSamCredential({ audience: "operator" });
  if (!cred) {
    return NextResponse.json({
      keyConfigured: false,
      apiReachable: false,
      message: "The SAM.gov platform key is not configured in this environment.",
    });
  }

  // This route is public (auth.config allow-lists it for uptime probes),
  // so it reports reachability only. It never echoes the upstream body
  // or error text, which could carry key-related detail
  // (BL-TENANT-AUDIT 2026-09). BL-STAB-7c — through samGetText: a 10 s
  // deadline, and the key only ever sent to SAM.gov.
  const url = new URL(SAM_BASE);
  url.search = new URLSearchParams({ samRegistered: "Yes", registrationStatus: "A", page: "0", size: "1" }).toString();
  const r = await samGetText(cred, url, "health");
  if (!r.ok) {
    return NextResponse.json({ keyConfigured: true, apiReachable: false, ...(r.status ? { status: r.status } : {}) });
  }
  let totalRecords: number | null = null;
  try {
    const parsed: unknown = JSON.parse(r.text);
    if (typeof parsed === "object" && parsed !== null && "totalRecords" in parsed) {
      const n = (parsed as { totalRecords: unknown }).totalRecords;
      totalRecords = typeof n === "number" ? n : null;
    }
  } catch {
    // Non-JSON upstream body — reachability is all we report.
  }
  return NextResponse.json({ keyConfigured: true, apiReachable: true, status: r.status, totalRecords });
}
