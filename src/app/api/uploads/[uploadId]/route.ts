import { NextResponse, type NextRequest } from "next/server";
import { requireApiTenant } from "@/lib/api-tenant";
import { appBaseUrl } from "@/lib/app-url";
import { uploadTransport } from "@/lib/storage";
import { receiveProxyUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-STAB-2c — uploads through the app, for when storage cannot take them
 * directly: the in-memory fallback (development, previews without R2) or
 * the operator's `UPLOAD_TRANSPORT=proxy` lever. Limited by the host's
 * request size (about 4.5 MB on Vercel); the upload intent already
 * refuses larger files in that mode. Off (404) when uploads go direct.
 */
export async function PUT(req: NextRequest, { params }: { params: { uploadId: string } }) {
  if (uploadTransport() !== "proxy") return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  const tenant = await requireApiTenant();
  if (!tenant.ok) return tenant.response;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin && origin !== appBaseUrl()) {
    return NextResponse.json({ ok: false, error: "Upload refused." }, { status: 403 });
  }
  const length = req.headers.get("content-length");
  const result = await receiveProxyUpload({
    organizationId: tenant.ctx.organizationId,
    actor: { userId: tenant.ctx.user.id, email: tenant.ctx.user.email ?? null },
    uploadId: params.uploadId,
    contentType: req.headers.get("content-type") ?? "",
    contentLength: length !== null && /^\d+$/.test(length) ? Number(length) : null,
    readBody: async () => new Uint8Array(await req.arrayBuffer()),
  });
  return NextResponse.json(result.body, { status: result.status });
}
