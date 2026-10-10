import { NextResponse } from "next/server";
import { samHealth } from "@/lib/samgov-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public (auth.config allow-lists it for uptime probes). FORGE's shared
 * key only, reachability and status only (BL-TENANT-AUDIT 2026-09,
 * BL-STAB-7c); at most one live SAM.gov request per 30 minutes, other
 * calls get the last answer marked `cached` (BL-STAB-10b).
 */
export async function GET() {
  return NextResponse.json(await samHealth());
}
