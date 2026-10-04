import { apiListProposals, handleApiV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** BL-16 apiAccess — GET /api/v1/proposals (?limit, cursor, updated_since, stage). */
export async function GET(req: Request) {
  return handleApiV1(req, "proposals.list", (caller, url) => apiListProposals(caller.organizationId, url));
}
