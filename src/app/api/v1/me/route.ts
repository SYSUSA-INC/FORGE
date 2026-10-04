import { apiMe, handleApiV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** BL-16 apiAccess — GET /api/v1/me: which workspace and token this is. */
export async function GET(req: Request) {
  return handleApiV1(req, "me", async (caller) => apiMe(caller));
}
