"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
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
import { stripExt } from "@/lib/solicitation-parse";
import { runDurable } from "@/lib/jobs";
import { claimUpload, finishClaim, inlineBytesForMemoryMode, releaseClaim } from "@/lib/uploads";
import { log } from "@/lib/log";

export type UploadResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * BL-STAB-2c — file an uploaded document as a new solicitation, or as an
 * amendment of `parentSolicitationId`. The browser has already sent the
 * file straight to storage and the server has checked it (the upload
 * ledger); this claims it once, creates the record with the id the claim
 * allocated (so a retry never creates a second one), and starts the parse,
 * which reads the file from storage. No file bytes pass through here, so
 * no upload is limited by the request size.
 */
export async function createSolicitationFromUploadAction(input: {
  uploadId: string;
  parentSolicitationId?: string | null;
  amendmentNumber?: string;
}): Promise<UploadResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const parentSolicitationId =
    typeof input?.parentSolicitationId === "string" && input.parentSolicitationId.trim() ? input.parentSolicitationId.trim() : null;
  const amendmentNumber = typeof input?.amendmentNumber === "string" ? input.amendmentNumber.trim().slice(0, 64) : "";

  // Verify the parent belongs to this org (before the claim, so a bad
  // parent leaves the upload ready to try again). BL-AIX Phase 0d — an
  // amendment joins its parent's opportunity.
  let parentOpportunityId: string | null = null;
  if (parentSolicitationId) {
    const [parentRow] = await db
      .select({ id: solicitations.id, opportunityId: solicitations.opportunityId })
      .from(solicitations)
      .where(and(eq(solicitations.id, parentSolicitationId), eq(solicitations.organizationId, organizationId)))
      .limit(1);
    if (!parentRow) return { ok: false, error: "Parent solicitation not found in this organization." };
    parentOpportunityId = parentRow.opportunityId;
  }

  const claim = await claimUpload({ organizationId, userId: user.id, uploadId: String(input?.uploadId ?? ""), resourceType: "solicitation" });
  if (!claim.ok) return { ok: false, error: claim.error };
  if ("alreadyClaimed" in claim) return { ok: true, id: claim.resourceId };
  const file = claim.claim;

  try {
    await db
      .insert(solicitations)
      .values({
        id: file.resourceId,
        organizationId,
        title: stripExt(file.fileName),
        fileName: file.fileName,
        fileSize: file.size,
        contentType: file.contentType,
        storagePath: file.storageKey,
        parseStatus: "uploaded",
        uploadedByUserId: user.id,
        source: "uploaded",
        parentSolicitationId,
        amendmentNumber,
        opportunityId: parentOpportunityId,
      })
      .onConflictDoNothing();
  } catch (err) {
    log.error("[createSolicitationFromUploadAction]", "insert failed", { error: err });
    await releaseClaim({ organizationId, uploadId: file.uploadId });
    return { ok: false, error: "Could not record the solicitation; try again." };
  }
  await finishClaim({ organizationId, uploadId: file.uploadId });

  // The parse reads the file from storage; in the in-memory mode it gets
  // the bytes in hand. A job already open for this record is reused.
  const bytes = await inlineBytesForMemoryMode({ organizationId, storagePath: file.storageKey });
  await runDurable(
    "[createSolicitationFromUploadAction] parse",
    { organizationId, kind: "solicitation_parse", resourceId: file.resourceId, requestedByUserId: user.id },
    bytes ? { bytes } : {},
  );

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: parentSolicitationId ? "solicitation.amendment.upload" : "solicitation.upload",
    resourceType: "solicitation",
    resourceId: file.resourceId,
    metadata: {
      uploadId: file.uploadId,
      fileName: file.fileName,
      fileSize: file.size,
      contentType: file.contentType,
      ...(parentSolicitationId ? { parentSolicitationId, amendmentNumber } : {}),
    },
  });

  revalidatePath("/solicitations");
  return { ok: true, id: file.resourceId };
}

/**
 * Re-run extraction on demand (idempotent). Useful after flipping
 * AI from stub to live mode.
 */
export async function reparseSolicitationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
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

  // BL-STAB-2c — check the file is there without downloading it; the job
  // reads it (within its read budget, verified) from storage.
  const head = await getStorageProvider().head(row.storagePath).catch(() => null);
  if (!head)
    return {
      ok: false,
      error:
        "File bytes are no longer in storage — re-upload the document. (Memory storage doesn't survive redeploys.)",
    };
  const bytes = await inlineBytesForMemoryMode({ organizationId, storagePath: row.storagePath });

  await runDurable(
    "[reparseSolicitationAction] parse",
    { organizationId, kind: "solicitation_parse", resourceId: id, requestedByUserId: user.id },
    bytes ? { bytes } : {},
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
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, solicitationId)));
    // BL-AIX Phase 0d — amendments already uploaded follow their parent.
    await db
      .update(solicitations)
      .set({ opportunityId: opp.id, updatedAt: new Date() })
      .where(
        and(
          eq(solicitations.organizationId, organizationId),
          eq(solicitations.parentSolicitationId, solicitationId),
          isNull(solicitations.opportunityId),
        ),
      );

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
