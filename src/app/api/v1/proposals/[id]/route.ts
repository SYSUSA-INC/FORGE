import { apiGetProposal, handleApiV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** BL-16 apiAccess — GET /api/v1/proposals/{id} with its section outline. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handleApiV1(req, "proposals.get", (caller) => apiGetProposal(caller.organizationId, params.id));
}
