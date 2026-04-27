"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  proposalSections,
  proposals,
  solicitations,
  type SolicitationType,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getStorageProvider } from "@/lib/storage";
import {
  aiExtractSolicitation,
  extractTextFromPdf,
} from "@/lib/solicitation-extract";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap for v1.
const ACCEPTED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/octet-stream", // some browsers send this for .pdf
]);

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
  // Browsers vary; trust the filename suffix as a fallback.
  const lower = file.name.toLowerCase();
  const isPdf =
    ACCEPTED_CONTENT_TYPES.has(file.type) || lower.endsWith(".pdf");
  if (!isPdf) {
    return {
      ok: false,
      error:
        "Only PDF uploads are supported in v1. DOCX / XLSX / OCR for scans coming next.",
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Insert the row first so the user sees an entry immediately.
  const [row] = await db
    .insert(solicitations)
    .values({
      organizationId,
      title: stripExt(file.name),
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || "application/pdf",
      parseStatus: "uploaded",
      uploadedByUserId: user.id,
      source: "uploaded",
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
      contentType: file.type || "application/pdf",
    });
    await db
      .update(solicitations)
      .set({
        storagePath: stored.storagePath,
        updatedAt: new Date(),
      })
      .where(eq(solicitations.id, row.id));
  } catch (err) {
    console.error("[uploadSolicitationAction] storage", err);
    await db
      .update(solicitations)
      .set({
        parseStatus: "failed",
        parseError:
          err instanceof Error ? err.message : "Storage write failed.",
        updatedAt: new Date(),
      })
      .where(eq(solicitations.id, row.id));
    return {
      ok: false,
      error: "Upload saved metadata but failed to store the file bytes.",
    };
  }

  // Kick off parsing in the same request so the user gets a populated
  // record on the redirect. Failures are recorded on the row and shown
  // on the detail page; the upload itself still succeeds.
  void parseSolicitationFromBytes(row.id, bytes).catch((err) =>
    console.error("[uploadSolicitationAction] inline parse failed", err),
  );

  revalidatePath("/solicitations");
  return { ok: true, id: row.id };
}

export async function uploadSolicitationAndGoAction(
  formData: FormData,
): Promise<void> {
  const res = await uploadSolicitationAction(formData);
  if (res.ok) redirect(`/solicitations/${res.id}`);
  throw new Error(res.ok ? "unreachable" : res.error);
}

async function parseSolicitationFromBytes(
  solicitationId: string,
  bytes: Uint8Array,
): Promise<void> {
  await db
    .update(solicitations)
    .set({ parseStatus: "parsing", parseError: "", updatedAt: new Date() })
    .where(eq(solicitations.id, solicitationId));

  let rawText = "";
  try {
    rawText = await extractTextFromPdf(bytes);
  } catch (err) {
    await db
      .update(solicitations)
      .set({
        parseStatus: "failed",
        parseError:
          err instanceof Error
            ? `PDF text extraction failed: ${err.message}`
            : "PDF text extraction failed.",
        updatedAt: new Date(),
      })
      .where(eq(solicitations.id, solicitationId));
    return;
  }

  if (!rawText.trim()) {
    await db
      .update(solicitations)
      .set({
        parseStatus: "failed",
        parseError:
          "No text extracted. The document may be a scanned image — OCR is not yet supported.",
        rawText: "",
        updatedAt: new Date(),
      })
      .where(eq(solicitations.id, solicitationId));
    return;
  }

  const aiRes = await aiExtractSolicitation(rawText);
  if (!aiRes.ok) {
    await db
      .update(solicitations)
      .set({
        parseStatus: "failed",
        parseError: aiRes.error,
        rawText: rawText.slice(0, 500_000),
        updatedAt: new Date(),
      })
      .where(eq(solicitations.id, solicitationId));
    return;
  }

  const d = aiRes.data;
  await db
    .update(solicitations)
    .set({
      parseStatus: "parsed",
      parseError: "",
      rawText: rawText.slice(0, 500_000),
      title: d.title || stripExt((await getFileName(solicitationId)) || ""),
      agency: d.agency,
      office: d.office,
      type: d.type as SolicitationType,
      solicitationNumber: d.solicitationNumber,
      naicsCode: d.naicsCode,
      setAside: d.setAside,
      responseDueDate: d.responseDueDate ? new Date(d.responseDueDate) : null,
      sectionLSummary: d.sectionLSummary,
      sectionMSummary: d.sectionMSummary,
      extractedRequirements: d.requirements,
      updatedAt: new Date(),
    })
    .where(eq(solicitations.id, solicitationId));
  revalidatePath(`/solicitations/${solicitationId}`);
}

async function getFileName(id: string): Promise<string> {
  const [row] = await db
    .select({ fileName: solicitations.fileName })
    .from(solicitations)
    .where(eq(solicitations.id, id))
    .limit(1);
  return row?.fileName ?? "";
}

function stripExt(name: string): string {
  return name.replace(/\.[^./]+$/, "");
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

  void parseSolicitationFromBytes(id, obj.bytes).catch((err) =>
    console.error("[reparseSolicitationAction] parse failed", err),
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
    console.error("[convertToOpportunityAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Convert failed.",
    };
  }
}
