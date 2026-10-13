"use server";

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
import { runDurableBatch, type JobSpec } from "@/lib/jobs";
import { log } from "@/lib/log";
import {
  claimUpload,
  finishClaim,
  inlineBytesForMemoryMode,
  peekStoredUploads,
  releaseClaim,
} from "@/lib/uploads";
import { GSA_MAX_ATTACHMENTS } from "./gsa-constants";

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
  const { organizationId } = await requireCurrentOrg();

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

  return aiExtractGsa(organizationId, rawText);
}

const NOTICE_TYPE_TO_SOLICITATION_TYPE: Record<string, SolicitationType> = {
  rfp: "rfp",
  rfq: "rfq",
  rfi: "rfi",
  sources_sought: "sources_sought",
  task_order: "rfp",
  other: "other",
};

export type GsaCreateInput = {
  /** The pasted email, kept on the opportunity's activity. */
  text: string;
  title: string;
  noticeType: string;
  solicitationNumber: string;
  buyingAgency: string;
  office: string;
  vehicle: string;
  naicsCode: string;
  setAside: string;
  /** YYYY-MM-DD, or "". */
  responseDueDate: string;
  placeOfPerformance: string;
  scopeSummary: string;
  notes: string;
  /** Attachments already uploaded to storage and checked (`useUploadQueue` without a claim). */
  uploadIds: string[];
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
 * Create an opportunity from the reviewed GSA extraction. BL-STAB-2d —
 * its attachments were uploaded straight to storage first, so this
 * request carries their ids, never their bytes (no request-size cap).
 * Every id is checked before anything is created; one that can't be
 * filed is reported back, and the opportunity is still created. Each
 * attachment is filed as a Solicitation linked to the opportunity, and
 * their parses run one after another in the background.
 */
export async function createOpportunityFromGsaAction(
  input: GsaCreateInput,
): Promise<GsaCreateResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const get = (key: keyof Omit<GsaCreateInput, "uploadIds">): string => {
    const v = input?.[key];
    return typeof v === "string" ? v : "";
  };

  const title = get("title").trim();
  if (!title) return { ok: false, error: "Title is required." };

  const uploadIds = Array.from(
    new Set(Array.isArray(input?.uploadIds) ? input.uploadIds.filter((id): id is string => typeof id === "string") : []),
  );
  if (uploadIds.length > GSA_MAX_ATTACHMENTS) {
    return {
      ok: false,
      error: `At most ${GSA_MAX_ATTACHMENTS} attachments at a time. Once the opportunity is created, add the others as documents on one of its solicitations.`,
    };
  }

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

  // Check every attachment before creating anything; one that can't be
  // filed (expired, someone else's, not a document) is reported back.
  const { ready, bad } = await peekStoredUploads({
    organizationId,
    userId: actor.id,
    uploadIds,
    resourceType: "solicitation",
  });
  const attachmentsSkipped: { name: string; reason: string }[] = bad.map((b) => ({
    name: b.fileName || "An attachment",
    reason: b.reason,
  }));

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
        attachmentsCount: ready.length,
      },
    });
  } catch (err) {
    log.error("[createOpportunityFromGsaAction]", "create", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }

  // File each attachment as a Solicitation linked to the new opportunity
  // (the upload ledger's claim: the record takes the id fixed at the
  // claim, so a retry never files it twice). The parses start together
  // below.
  const solicitationIds: string[] = [];
  const parses: { spec: JobSpec; bytes?: Uint8Array }[] = [];
  for (const upload of ready) {
    const claim = await claimUpload({ organizationId, userId: actor.id, uploadId: upload.uploadId, resourceType: "solicitation" });
    if (!claim.ok) {
      attachmentsSkipped.push({ name: upload.fileName, reason: claim.error });
      continue;
    }
    if ("alreadyClaimed" in claim) {
      attachmentsSkipped.push({ name: upload.fileName, reason: "This file was already saved on another record." });
      continue;
    }
    const file = claim.claim;
    let inserted: { id: string }[];
    try {
      inserted = await db
        .insert(solicitations)
        .values({
          id: file.resourceId,
          organizationId,
          title: stripExt(file.fileName),
          type: solicitationType,
          solicitationNumber,
          fileName: file.fileName,
          fileSize: file.size,
          contentType: file.contentType,
          storagePath: file.storageKey,
          parseStatus: "uploaded",
          uploadedByUserId: actor.id,
          source: "gsa-paste",
          opportunityId,
        })
        .onConflictDoNothing()
        .returning({ id: solicitations.id });
    } catch (err) {
      log.error("[createOpportunityFromGsaAction]", "attachment insert failed", { error: err, uploadId: file.uploadId });
      await releaseClaim({ organizationId, uploadId: file.uploadId });
      attachmentsSkipped.push({ name: file.fileName, reason: "Could not record the solicitation." });
      continue;
    }
    await finishClaim({ organizationId, uploadId: file.uploadId });
    if (inserted.length === 0) {
      // An earlier attempt that died filed it already, on its own opportunity.
      attachmentsSkipped.push({ name: file.fileName, reason: "This file was already saved on another record." });
      continue;
    }
    solicitationIds.push(file.resourceId);
    // BL-AIP-1 — extract the attachment the same way an upload is; the
    // job reads it from storage (in the in-memory mode, from these bytes).
    const bytes = await inlineBytesForMemoryMode({ organizationId, storagePath: file.storageKey });
    parses.push({
      spec: { organizationId, kind: "solicitation_parse", resourceId: file.resourceId, requestedByUserId: actor.id },
      ...(bytes ? { bytes } : {}),
    });
  }
  if (parses.length > 0) {
    await runDurableBatch("[createOpportunityFromGsaAction] attachment parse", parses);
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
      uploadIds,
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
