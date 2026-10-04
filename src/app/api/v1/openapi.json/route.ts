import { NextResponse } from "next/server";
import { opportunityStageEnum, proposalSectionKindEnum, proposalSectionStatusEnum, proposalStageEnum } from "@/db/schema";
import { buildOpenApiDocument } from "@/lib/api-openapi";
import { appBaseUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BL-16 API Slice 2a — GET /api/v1/openapi.json: the OpenAPI 3.1
 * description of the API. Public and token-free: it describes the
 * endpoints and holds no workspace data. Readable cross-origin so API
 * tools in the browser can load it.
 */
export async function GET() {
  const doc = buildOpenApiDocument({
    baseUrl: appBaseUrl(),
    opportunityStages: opportunityStageEnum.enumValues,
    proposalStages: proposalStageEnum.enumValues,
    sectionKinds: proposalSectionKindEnum.enumValues,
    sectionStatuses: proposalSectionStatusEnum.enumValues,
  });
  return NextResponse.json(doc, {
    headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
