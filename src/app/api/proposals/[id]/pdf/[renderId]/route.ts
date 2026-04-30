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

  const ct = row.contentType;
  const map: Record<
    string,
    { contentType: string; ext: string }
  > = {
    pdf: { contentType: "application/pdf", ext: "pdf" },
    html: { contentType: "text/html; charset=utf-8", ext: "html" },
    docx: {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ext: "docx",
    },
  };
  const meta = map[ct] ?? map.html!;
  const filename = `proposal-${row.proposalId}-${row.id}.${meta.ext}`;
  // Word docs need to download (not render inline) to behave well in
  // the browser. PDFs render inline.
  const disposition = ct === "docx" ? "attachment" : "inline";

  return new NextResponse(Buffer.from(obj.bytes), {
    status: 200,
    headers: {
      "content-type": meta.contentType,
      "content-length": String(row.byteSize),
      "content-disposition": `${disposition}; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
