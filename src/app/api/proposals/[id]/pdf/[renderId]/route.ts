import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { proposalPdfRenders } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; renderId: string } },
) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      id: proposalPdfRenders.id,
      proposalId: proposalPdfRenders.proposalId,
      storagePath: proposalPdfRenders.storagePath,
      contentType: proposalPdfRenders.contentType,
      byteSize: proposalPdfRenders.byteSize,
    })
    .from(proposalPdfRenders)
    .where(
      and(
        eq(proposalPdfRenders.id, params.renderId),
        eq(proposalPdfRenders.proposalId, params.id),
        eq(proposalPdfRenders.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Render not found." }, { status: 404 });
  }

  const storage = getStorageProvider();
  const obj = await storage.get(row.storagePath);
  if (!obj) {
    return NextResponse.json(
      {
        error:
          "Render bytes not available — the storage layer no longer has them. Re-render the proposal.",
      },
      { status: 410 },
    );
  }

  const isPdf = row.contentType === "pdf";
  const contentType = isPdf ? "application/pdf" : "text/html; charset=utf-8";
  const filename = `proposal-${row.proposalId}-${row.id}.${isPdf ? "pdf" : "html"}`;

  return new NextResponse(Buffer.from(obj.bytes), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(row.byteSize),
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
