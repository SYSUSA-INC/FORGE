import { apiGetOpportunity, handleApiV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** BL-16 apiAccess — GET /api/v1/opportunities/{id}. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handleApiV1(req, "opportunities.get", (caller) => apiGetOpportunity(caller.organizationId, params.id));
}
