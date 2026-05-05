"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  solicitations,
  type SolicitationType,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { aiExtractGsa } from "@/lib/gsa-extract";
import type { GsaExtractionResult } from "@/lib/ai-prompts";
import { getStorageProvider } from "@/lib/storage";
import { detectFormat } from "@/lib/text-extract";
import { log } from "@/lib/log";

export type GsaParseResult =
  | {
      ok: true;
      data: GsaExtractionResult;
      provider: string;
      model: string;
      stubbed: boolean;
    }
  | { ok: false; error: string };

/**
 * Parse a forwarded GSA email body via AI. Returns the structured
 * extraction; the caller renders editable fields and calls
 * `createOpportunityFromGsaAction` to persist.
 */
export async function parseGsaTextAction(
  rawText: string,
): Promise<GsaParseResult> {
  await requireAuth();
  await requireCurrentOrg();

  if (!rawText || rawText.trim().length === 0) {
    return { ok: false, error: "Paste the GSA email body before extracting." };
  }
  if (rawText.length > 200_000) {
    return {
      ok: false,
      error:
        "Pasted text is unusually long. Trim to the email body and resubmit (or use the file-upload solicitation intake for full RFPs).",
    };
  }

  return aiExtractGsa(rawText);
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_ATTACHMENTS = 5;

const NOTICE_TYPE_TO_SOLICITATION_TYPE: Record<string, SolicitationType> = {
  rfp: "rfp",
  rfq: "rfq",
  rfi: "rfi",
  sources_sought: "sources_sought",
  task_order: "rfp",
  other: "other",
};

export type GsaCreateResult =
  | {
      ok: true;
      opportunityId: string;
      solicitationIds: string[];
      attachmentsSkipped: { name: string; reason: string }[];
    }
  | { ok: false; error: string };

/**
 * Create an opportunity from the reviewed GSA extraction, optionally
 * attaching uploaded files. Each file becomes a Solicitation row
 * linked to the new opportunity, with bytes stored via the same
 * pipeline as `/solicitations/new`.
 *
 * Multipart inputs (because of the file uploads):
 *   text             — original pasted email (string)
 *   title            — string
 *   noticeType       — "rfp" | "rfq" | "rfi" | "sources_sought" | "task_order" | "other"
 *   solicitationNumber, buyingAgency, office, vehicle, naicsCode,
 *   setAside, responseDueDate (YYYY-MM-DD or ""), placeOfPerformance,
 *   scopeSummary, notes — strings
 *   files            — File[] (zero or more attachments)
 */
export async function createOpportunityFromGsaAction(
  formData: FormData,
): Promise<GsaCreateResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const get = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v : "";
  };

  const title = get("title").trim();
  if (!title) return { ok: false, error: "Title is required." };

  const noticeType = get("noticeType") || "other";
  const solicitationType: SolicitationType =
    NOTICE_TYPE_TO_SOLICITATION_TYPE[noticeType] ?? "other";

  const dueRaw = get("responseDueDate");
  const due =
    dueRaw && dueRaw.match(/^\d{4}-\d{2}-\d{2}/) ? new Date(dueRaw) : null;

  const buyingAgency = get("buyingAgency").trim();
  const vehicle = get("vehicle").trim();
  const office = get("office").trim();
  const solicitationNumber = get("solicitationNumber").trim();
  const naicsCode = get("naicsCode").trim();
  const setAside = get("setAside").trim();
  const placeOfPerformance = get("placeOfPerformance").trim();
  const scopeSummary = get("scopeSummary").trim();
  const notes = get("notes").trim();
  const rawText = get("text");

  const description = [
    scopeSummary,
    notes ? `\nNotes:\n${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Display agency: vehicle prefix when present, then end-customer.
  // e.g. "GSA Polaris · Department of Veterans Affairs".
  const agencyDisplay = [
    vehicle ? `GSA ${vehicle}` : "GSA",
    buyingAgency,
  ]
    .filter(Boolean)
    .join(" · ");

  // Validate attachments up front so we don't half-create an
  // opportunity with garbage uploads.
  const files = formData.getAll("files").filter(
    (f): f is File => f instanceof File && f.size > 0,
  );
  if (files.length > MAX_ATTACHMENTS) {
    return {
      ok: false,
      error: `Max ${MAX_ATTACHMENTS} attachments at a time. Upload the rest from the opportunity detail page after this one is created.`,
    };
  }
  const attachmentsSkipped: { name: string; reason: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      attachmentsSkipped.push({
        name: f.name,
        reason: `larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
      });
    }
    const fmt = detectFormat(f.type, f.name);
    if (!fmt) {
      attachmentsSkipped.push({
        name: f.name,
        reason: "unsupported format (use PDF / DOCX / XLSX / PPTX / TXT / image)",
      });
    }
  }
  const acceptedFiles = files.filter(
    (f) =>
      f.size <= MAX_ATTACHMENT_BYTES && detectFormat(f.type, f.name) !== null,
  );

  // Create the opportunity first. If anything below fails we'll
  // report a partial success rather than rolling back — the
  // opportunity itself is still useful.
  let opportunityId: string;
  try {
    const [opp] = await db
      .insert(opportunities)
      .values({
        organizationId,
        title,
        agency: agencyDisplay,
        office,
        stage: "identified",
        solicitationNumber,
        noticeId: "",
        responseDueDate: due,
        naicsCode,
        setAside,
        placeOfPerformance,
        description,
        ownerUserId: actor.id,
        createdByUserId: actor.id,
      })
      .returning({ id: opportunities.id });

    if (!opp) return { ok: false, error: "Could not create opportunity." };
    opportunityId = opp.id;

    // Activity entry capturing the source of truth (raw email body).
    await db.insert(opportunityActivities).values({
      opportunityId: opp.id,
      userId: actor.id,
      kind: "note",
      title: "Created from GSA email paste",
      body: rawText.slice(0, 50_000),
      metadata: {
        source: "gsa-paste",
        noticeType,
        attachmentsCount: acceptedFiles.length,
      },
    });
  } catch (err) {
    log.error("[createOpportunityFromGsaAction]", "create", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }

  // Upload each attachment as a Solicitation row linked to the new
  // opportunity. Failures here are recorded on the row + reported
  // back to the caller; the opportunity itself stays.
  const solicitationIds: string[] = [];
  for (const file of acceptedFiles) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [row] = await db
        .insert(solicitations)
        .values({
          organizationId,
          title: stripExt(file.name),
          type: solicitationType,
          solicitationNumber,
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || "application/octet-stream",
          parseStatus: "uploaded",
          uploadedByUserId: actor.id,
          source: "gsa-paste",
          opportunityId,
        })
        .returning({ id: solicitations.id });
      if (!row) {
        attachmentsSkipped.push({
          name: file.name,
          reason: "could not record solicitation row",
        });
        continue;
      }

      const storage = getStorageProvider();
      const key = `org/${organizationId}/solicitation/${row.id}/${file.name}`;
      const stored = await storage.put({
        key,
        bytes,
        contentType: file.type || "application/octet-stream",
      });
      await db
        .update(solicitations)
        .set({
          storagePath: stored.storagePath,
          updatedAt: new Date(),
        })
        .where(eq(solicitations.id, row.id));

      solicitationIds.push(row.id);
    } catch (err) {
      log.error("[createOpportunityFromGsaAction]", "attachment", {
        error: err,
        fileName: file.name,
      });
      attachmentsSkipped.push({
        name: file.name,
        reason: err instanceof Error ? err.message : "upload failed",
      });
    }
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.create_from_gsa",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: {
      title,
      noticeType,
      attachments: solicitationIds.length,
      attachmentsSkipped: attachmentsSkipped.length,
    },
  });

  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/solicitations");
  revalidatePath("/");

  return {
    ok: true,
    opportunityId,
    solicitationIds,
    attachmentsSkipped,
  };
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
