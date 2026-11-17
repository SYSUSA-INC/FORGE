import { NextResponse } from "next/server";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordRead } from "@/lib/audit-log";
import { readReplyAttachment } from "@/lib/correspondence";

export const dynamic = "force-dynamic";

/**
 * BL-NAV-LIFECYCLE 6c — download one attachment of a reply filed to an
 * opportunity. `?i=` is the attachment's position in the message. The
 * read is audited (`opportunity.correspondence.read`).
 */
export async function GET(req: Request, { params }: { params: { id: string; emailId: string } }) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const index = Number(new URL(req.url).searchParams.get("i") ?? "0");
  const found = Number.isInteger(index) && index >= 0 ? await readReplyAttachment({ organizationId, opportunityId: params.id, emailId: params.emailId, index }) : null;
  if (!found) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const { file, object } = found;
  if (!object) return NextResponse.json({ error: "The attachment is no longer in storage." }, { status: 410 });

  await recordRead({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "opportunity.correspondence.read",
    resourceType: "opportunity",
    resourceId: params.id,
    metadata: { emailId: params.emailId, attachment: file.name, byteSize: object.bytes.byteLength },
  });
  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      // Always a download, as plain bytes: a stranger's attachment is never rendered on FORGE's origin.
      "content-type": "application/octet-stream",
      "content-length": String(object.bytes.byteLength),
      "content-disposition": `attachment; filename="${file.name.replace(/[^A-Za-z0-9 ._()-]/g, "-")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
