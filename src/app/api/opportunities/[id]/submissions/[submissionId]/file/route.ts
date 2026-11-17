import { NextResponse } from "next/server";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordRead } from "@/lib/audit-log";
import { readSubmissionFile } from "@/lib/deliver-store";

export const dynamic = "force-dynamic";

/**
 * BL-NAV-LIFECYCLE 6b-2 — download one kept file of a submission: the
 * copy of what was sent, or a receipt. `?i=` is the file's position in
 * the submission's list. The read is audited
 * (`proposal.submission.download`).
 */
export async function GET(req: Request, { params }: { params: { id: string; submissionId: string } }) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const index = Number(new URL(req.url).searchParams.get("i") ?? "0");
  const found = Number.isInteger(index) && index >= 0 ? await readSubmissionFile({ organizationId, opportunityId: params.id, submissionId: params.submissionId, index }) : null;
  if (!found) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const { file, object } = found;
  if (!object) return NextResponse.json({ error: "The kept copy is no longer in storage." }, { status: 410 });

  await recordRead({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "proposal.submission.download",
    resourceType: "proposal",
    resourceId: found.proposalId,
    metadata: { submissionId: params.submissionId, opportunityId: params.id, fileName: file.fileName, kind: file.kind ?? "proposal", byteSize: object.bytes.byteLength, sha256: file.sha256 },
  });
  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      "content-type": object.contentType || "application/octet-stream",
      "content-length": String(object.bytes.byteLength),
      // Always a download: an uploaded receipt is never rendered on FORGE's origin.
      "content-disposition": `attachment; filename="${file.fileName.replace(/[^A-Za-z0-9 ._()-]/g, "-")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
