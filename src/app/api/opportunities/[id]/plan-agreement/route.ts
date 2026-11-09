import { NextResponse } from "next/server";
import { recordRead } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { agreementFileOf } from "@/lib/plan-charter-store";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** BL-NAV-LIFECYCLE 4c-1 — the teaming agreement's file on an opportunity's plan, for a member of the organization. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const file = await agreementFileOf(organizationId, params.id);
  if (!file) return NextResponse.json({ error: "No agreement file." }, { status: 404 });
  const obj = await getStorageProvider().get(file.storageKey);
  if (!obj) return NextResponse.json({ error: "The file is no longer in storage." }, { status: 404 });
  await recordRead({ organizationId, actor: { userId: user.id, email: user.email }, action: "opportunity.plan.agreement.download", resourceType: "opportunity", resourceId: params.id, metadata: { fileName: file.fileName } });
  const name = file.fileName.replace(/[^\w.\- ]+/g, "_") || "agreement";
  return new NextResponse(Buffer.from(obj.bytes), { headers: { "Content-Type": obj.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
