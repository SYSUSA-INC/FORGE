"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  solicitations,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { getStorageProvider } from "@/lib/storage";
import { parseSolicitationFromBytes, stripExt } from "@/lib/solicitation-parse";
import { detectFormat } from "@/lib/text-extract";
import { log } from "@/lib/log";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap for v1.

export type UploadResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function uploadSolicitationAction(
  formData: FormData,
): Promise<UploadResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Pick a file to upload." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Selected file is empty." };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `File is larger than ${MAX_BYTES / 1024 / 1024} MB. Trim or split the document first.`,
    };
  }
  const format = detectFormat(file.type, file.name);
  if (!format) {
    return {
      ok: false,
      error:
        "Unsupported file type. Accepted: PDF, DOCX, XLSX, PPTX, TXT/MD, or image (JPEG/PNG/WebP/GIF).",
    };
  }

  // BL-FB-SOL-AMEND-DIFF — optional amendment parent. When set, the
  // upload becomes a child amendment of the parent solicitation.
  const parentSolicitationIdRaw = formData.get("parentSolicitationId");
  const amendmentNumberRaw = formData.get("amendmentNumber");
  const parentSolicitationId =
    typeof parentSolicitationIdRaw === "string" &&
    parentSolicitationIdRaw.trim().length > 0
      ? parentSolicitationIdRaw.trim()
      : null;
  const amendmentNumber =
    typeof amendmentNumberRaw === "string"
      ? amendmentNumberRaw.trim().slice(0, 64)
      : "";

  // Verify the parent belongs to this org so a hand-typed UUID can't
  // attach an amendment to another tenant's solicitation.
  if (parentSolicitationId) {
    const [parentRow] = await db
      .select({ id: solicitations.id })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.id, parentSolicitationId),
          eq(solicitations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!parentRow) {
      return {
        ok: false,
        error: "Parent solicitation not found in this organization.",
      };
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Insert the row first so the user sees an entry immediately.
  const resolvedContentType =
    file.type || guessContentTypeFromFormat(format);

  const [row] = await db
    .insert(solicitations)
    .values({
      organizationId,
      title: stripExt(file.name),
      fileName: file.name,
      fileSize: file.size,
      contentType: resolvedContentType,
      parseStatus: "uploaded",
      uploadedByUserId: user.id,
      source: "uploaded",
      parentSolicitationId,
      amendmentNumber,
    })
    .returning({ id: solicitations.id });
  if (!row) return { ok: false, error: "Could not record solicitation." };

  // Store the bytes via the storage provider.
  try {
    const storage = getStorageProvider();
    const key = `org/${organizationId}/solicitation/${row.id}/${file.name}`;
    const stored = await storage.put({
      key,
      bytes,
      contentType: resolvedContentType,
    });
    await db
      .update(solicitations)
      .set({
        storagePath: stored.storagePath,
        updatedAt: new Date(),
      })
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, row.id)));
  } catch (err) {
    log.error("[uploadSolicitationAction]", "storage", { error: err });
    await db
      .update(solicitations)
      .set({
        parseStatus: "failed",
        parseError:
          err instanceof Error ? err.message : "Storage write failed.",
        updatedAt: new Date(),
      })
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, row.id)));
    return {
      ok: false,
      error: "Upload saved metadata but failed to store the file bytes.",
    };
  }

  // Kick off parsing in the same request so the user gets a populated
  // record on the redirect. Failures are recorded on the row and shown
  // on the detail page; the upload itself still succeeds.
  void parseSolicitationFromBytes(row.id, organizationId, bytes).catch((err) =>
    log.error("[uploadSolicitationAction]", "inline parse failed", { error: err }),
  );

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: parentSolicitationId
      ? "solicitation.amendment.upload"
      : "solicitation.upload",
    resourceType: "solicitation",
    resourceId: row.id,
    metadata: {
      fileName: file.name,
      fileSize: file.size,
      contentType: resolvedContentType,
      ...(parentSolicitationId
        ? { parentSolicitationId, amendmentNumber }
        : {}),
    },
  });

  revalidatePath("/solicitations");
  return { ok: true, id: row.id };
}

function guessContentTypeFromFormat(
  format: ReturnType<typeof detectFormat>,
): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "image":
      return "image/png";
    case "text":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

/**
 * Re-run extraction on demand (idempotent). Useful after flipping
 * AI from stub to live mode.
 */
export async function reparseSolicitationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      id: solicitations.id,
      storagePath: solicitations.storagePath,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, id),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Solicitation not found." };
  if (!row.storagePath)
    return { ok: false, error: "No file stored for this solicitation." };

  const storage = getStorageProvider();
  const obj = await storage.get(row.storagePath);
  if (!obj)
    return {
      ok: false,
      error:
        "File bytes are no longer in storage — re-upload the document. (Memory storage doesn't survive redeploys.)",
    };

  void parseSolicitationFromBytes(id, organizationId, obj.bytes).catch((err) =>
    log.error("[reparseSolicitationAction]", "parse failed", { error: err }),
  );
  return { ok: true };
}

export async function deleteSolicitationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await db
    .delete(solicitations)
    .where(
      and(
        eq(solicitations.id, id),
        eq(solicitations.organizationId, organizationId),
      ),
    );
  revalidatePath("/solicitations");
  return { ok: true };
}

/**
 * Convert a parsed solicitation into a real Opportunity, copying the
 * extracted metadata over. Returns the opportunity id so the caller
 * can redirect.
 */
export async function convertToOpportunityAction(
  solicitationId: string,
): Promise<
  { ok: true; opportunityId: string } | { ok: false; error: string }
> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select()
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Solicitation not found." };

  // If already linked, just return that opportunity.
  if (row.opportunityId) {
    return { ok: true, opportunityId: row.opportunityId };
  }

  try {
    const [opp] = await db
      .insert(opportunities)
      .values({
        organizationId,
        title: row.title || row.fileName || "Untitled solicitation",
        agency: row.agency,
        office: row.office,
        solicitationNumber: row.solicitationNumber,
        noticeId: row.noticeId,
        naicsCode: row.naicsCode,
        setAside: row.setAside,
        responseDueDate: row.responseDueDate,
        ownerUserId: user.id,
        createdByUserId: user.id,
      })
      .returning({ id: opportunities.id });
    if (!opp)
      return { ok: false, error: "Could not create opportunity." };

    await db
      .update(solicitations)
      .set({ opportunityId: opp.id, updatedAt: new Date() })
      .where(eq(solicitations.id, solicitationId));

    // Drop a system activity entry on the opportunity so the trail is
    // explicit about where the metadata came from.
    await db.insert(opportunityActivities).values({
      opportunityId: opp.id,
      userId: user.id,
      kind: "note",
      title: "Created from solicitation intake",
      body: row.fileName
        ? `Imported metadata from uploaded solicitation file ${row.fileName}.`
        : "Imported metadata from solicitation intake.",
    });

    revalidatePath("/solicitations");
    revalidatePath(`/solicitations/${solicitationId}`);
    revalidatePath(`/opportunities/${opp.id}`);
    return { ok: true, opportunityId: opp.id };
  } catch (err) {
    log.error("[convertToOpportunityAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Convert failed.",
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// BL-FB-SOL-AMEND-DIFF — amendment list + diff actions
// ────────────────────────────────────────────────────────────────────

export type AmendmentListRow = {
  id: string;
  amendmentNumber: string;
  title: string;
  fileName: string;
  parseStatus: string;
  responseDueDate: string | null;
  createdAt: string;
};

export async function listAmendmentsAction(
  parentSolicitationId: string,
): Promise<AmendmentListRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Verify the parent belongs to this org first.
  const [parentRow] = await db
    .select({ id: solicitations.id })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, parentSolicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!parentRow) return [];

  const rows = await db
    .select({
      id: solicitations.id,
      amendmentNumber: solicitations.amendmentNumber,
      title: solicitations.title,
      fileName: solicitations.fileName,
      parseStatus: solicitations.parseStatus,
      responseDueDate: solicitations.responseDueDate,
      createdAt: solicitations.createdAt,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.parentSolicitationId, parentSolicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .orderBy(asc(solicitations.createdAt));

  return rows.map((r) => ({
    id: r.id,
    amendmentNumber: r.amendmentNumber,
    title: r.title,
    fileName: r.fileName,
    parseStatus: r.parseStatus,
    responseDueDate: r.responseDueDate
      ? r.responseDueDate.toISOString().slice(0, 10)
      : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type AmendmentDiffResult =
  | {
      ok: true;
      base: { id: string; label: string };
      amendment: { id: string; label: string };
      diff: import("@/lib/solicitation-amendment-diff").AmendmentDiff;
    }
  | { ok: false; error: string };

/**
 * Compute the diff between an amendment and a comparison base.
 * When `baseSolicitationId` is omitted, diffs against the amendment's
 * parent.
 */
export async function getAmendmentDiffAction(
  amendmentId: string,
  baseSolicitationId?: string,
): Promise<AmendmentDiffResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const { computeAmendmentDiff } = await import(
    "@/lib/solicitation-amendment-diff"
  );

  const [amendment] = await db
    .select()
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, amendmentId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!amendment) return { ok: false, error: "Amendment not found." };

  const baseId = baseSolicitationId ?? amendment.parentSolicitationId;
  if (!baseId) {
    return {
      ok: false,
      error:
        "This solicitation is not linked to a parent. Mark it as an amendment first.",
    };
  }

  const [base] = await db
    .select()
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, baseId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!base) {
    return { ok: false, error: "Base solicitation not found." };
  }

  if (base.parseStatus !== "parsed") {
    return {
      ok: false,
      error: "Base solicitation hasn't finished parsing — wait for it, then re-try.",
    };
  }
  if (amendment.parseStatus !== "parsed") {
    return {
      ok: false,
      error: "Amendment hasn't finished parsing — wait for it, then re-try.",
    };
  }

  const diff = computeAmendmentDiff(base, amendment);

  return {
    ok: true,
    base: {
      id: base.id,
      label:
        base.amendmentNumber
          ? `Amendment ${base.amendmentNumber}`
          : base.title || base.fileName || "Base solicitation",
    },
    amendment: {
      id: amendment.id,
      label:
        amendment.amendmentNumber
          ? `Amendment ${amendment.amendmentNumber}`
          : amendment.title || amendment.fileName || "Amendment",
    },
    diff,
  };
}
