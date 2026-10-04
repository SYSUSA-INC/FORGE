import { apiGetSection, handleApiV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** BL-16 API Slice 2b — GET /api/v1/proposals/{id}/sections/{sectionId}: one section with its text. */
export async function GET(req: Request, { params }: { params: { id: string; sectionId: string } }) {
  return handleApiV1(req, "proposals.sections.get", (caller) => apiGetSection(caller.organizationId, params.id, params.sectionId));
}
