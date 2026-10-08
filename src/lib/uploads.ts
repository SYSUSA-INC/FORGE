/**
 * BL-STAB-2b — the upload ledger: browser uploads straight to storage.
 *
 *   intent   → a `pending` row and a short-lived presigned PUT for a key
 *              the server built (org + random id; no client input)
 *   PUT      → the browser sends the bytes to storage, never to the app
 *   complete → the server checks what arrived (size, type, first bytes)
 *              and marks the row `stored`, claimable for 24 hours
 *   claim    → a typed action files it on a record: `stored → claiming`
 *              with the record id allocated up front, then `claimed`
 *
 * No step uses a transaction: every change is one conditional UPDATE, and
 * a claim that dies halfway is retried with the same record id.
 *
 * Server-only. Every read and write is scoped by organizationId (and by
 * the uploading user for complete / claim / cancel); callers own auth.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { fileUploads, type FileUpload } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getStorageProvider, memoryStorageRefused, uploadTransport } from "@/lib/storage";
import {
  assertKeyInOrg,
  expirySecondsFor,
  isKeyInOrg,
  PROXY_MAX_BYTES_ON_VERCEL,
  resolvePolicy,
  UPLOAD_POLICIES,
  UPLOAD_PURPOSES,
  uploadKeyFor,
  validateUploadRequest,
  type UploadFormat,
  type UploadPurpose,
  type UploadResourceType,
  type UploadTransport,
  type UploadView,
} from "@/lib/upload-policy";
import { describeMismatch, familyMatches, sniffFormat } from "@/lib/upload-verify";

export type UploadActor = { userId: string; email: string | null };

const MINUTE = 60_000;
const CLAIM_WINDOW_MS = 24 * 60 * MINUTE;
const STALE_CLAIM_MS = 2 * MINUTE;
const MAX_PENDING_PER_USER = 10;
const MAX_STORED_PER_USER = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dailyIngressBytes(env: Record<string, string | undefined> = process.env): number {
  const gb = Number(env.UPLOAD_DAILY_GB_PER_ORG ?? "50");
  return Number.isFinite(gb) && gb > 0 ? gb * 1024 ** 3 : 0;
}

const FAILURE_MESSAGES: Record<string, string> = {
  expired: "The upload link expired before the file arrived. Upload it again.",
  size_mismatch: "The file that arrived is not the size that was declared. Upload it again.",
  type_mismatch: "The file's contents don't match its type.",
  cancelled: "Upload cancelled.",
  unclaimed: "The upload was not saved within a day and was removed. Upload it again.",
  claim_failed: "The file could not be read.",
};

function view(row: FileUpload): UploadView {
  return {
    uploadId: row.id,
    status: row.status,
    fileName: row.fileName,
    size: row.storedSize ?? row.declaredSize,
    format: (row.detectedFormat || row.declaredFormat) as UploadFormat,
    contentType: row.contentType,
    failureReason: row.failureReason,
    message: row.failureDetail || FAILURE_MESSAGES[row.failureReason] || "",
  };
}

async function loadOwn(organizationId: string, userId: string, uploadId: string): Promise<FileUpload | null> {
  if (!UUID.test(uploadId)) return null;
  const [row] = await db
    .select()
    .from(fileUploads)
    .where(and(eq(fileUploads.organizationId, organizationId), eq(fileUploads.id, uploadId), eq(fileUploads.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Delete an upload's object, as far as storage allows; the sweeper retries what fails. */
async function deleteObject(organizationId: string, key: string): Promise<void> {
  try {
    assertKeyInOrg(organizationId, key);
    await getStorageProvider().delete(key);
  } catch (err) {
    log.warn("[uploads]", "could not delete an upload's object; the sweeper will retry", { organizationId, error: err });
  }
}

export type UploadIntentResult =
  | {
      ok: true;
      uploadId: string;
      transport: UploadTransport;
      put: { url: string; method: "PUT"; headers: Record<string, string> };
      expiresAt: string;
      maxBytes: number;
    }
  | { ok: false; code: string; error: string };

/**
 * Ask to upload one file. Checks the environment, the file (name, format,
 * size), the user's rate and caps and the organization's daily volume,
 * then records a `pending` row and signs a link for exactly this key,
 * type and size. Callers have already checked the purpose's own gates
 * (organization admin for templates, platform admin for diagnostics) and
 * refused impersonation.
 */
export async function createUploadIntent(i: {
  organizationId: string;
  actor: UploadActor;
  purpose: UploadPurpose;
  fileName: string;
  size: number;
  origin: string;
}): Promise<UploadIntentResult> {
  const { organizationId, actor } = i;
  if (!(UPLOAD_PURPOSES as readonly string[]).includes(i.purpose)) return { ok: false, code: "bad_purpose", error: "Unknown upload purpose." };
  if (typeof i.fileName !== "string" || i.fileName.length > 1024) return { ok: false, code: "bad_name", error: "That file name is not accepted." };
  if (memoryStorageRefused()) {
    log.error("[uploads]", "upload refused: production or staging is on memory storage", { organizationId });
    return {
      ok: false,
      code: "storage_unconfigured",
      error:
        "File storage isn't set up on this site, so files can't be uploaded yet. A FORGE platform admin connects Cloudflare R2 (four settings on Vercel) and checks it on Admin → Jobs → File storage.",
    };
  }
  const check = validateUploadRequest({ purpose: i.purpose, fileName: i.fileName, size: i.size, env: process.env });
  if (!check.ok) return check;
  const transport = uploadTransport();
  if (transport === "proxy" && process.env.VERCEL && i.size > PROXY_MAX_BYTES_ON_VERCEL) {
    return { ok: false, code: "proxy_too_large", error: "Uploads on this site are limited to 4 MB until file storage is set up for direct uploads." };
  }

  const rate = await enforceRateLimit({ key: `upload-intent:user:${actor.userId}`, limit: 300, windowSeconds: 3600 });
  if (!rate.ok) return { ok: false, code: "rate_limited", error: `Too many uploads started; try again in ${Math.ceil(rate.retryAfter / 60)} minutes.` };

  const now = new Date();
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${fileUploads.userId} = ${actor.userId} and ${fileUploads.status} = 'pending' and ${fileUploads.urlExpiresAt} > now())`,
      stored: sql<number>`count(*) filter (where ${fileUploads.userId} = ${actor.userId} and ${fileUploads.status} = 'stored')`,
      ingress: sql<number>`coalesce(sum(${fileUploads.declaredSize}) filter (where ${fileUploads.createdAt} > now() - interval '24 hours'), 0)`,
    })
    .from(fileUploads)
    .where(eq(fileUploads.organizationId, organizationId));
  if (Number(counts?.pending ?? 0) >= MAX_PENDING_PER_USER) {
    return { ok: false, code: "too_many_pending", error: "Several uploads are already in progress; let them finish first." };
  }
  if (Number(counts?.stored ?? 0) >= MAX_STORED_PER_USER) {
    return { ok: false, code: "too_many_stored", error: "Too many uploaded files are waiting to be saved; save or remove some first." };
  }
  const dailyCap = dailyIngressBytes();
  if (dailyCap > 0 && Number(counts?.ingress ?? 0) + i.size > dailyCap) {
    return { ok: false, code: "daily_cap", error: "This organization has reached its daily upload volume. Try again tomorrow." };
  }

  const policy = resolvePolicy(i.purpose, process.env);
  const uploadId = randomUUID();
  const storageKey = uploadKeyFor(organizationId, uploadId, policy.transient);
  assertKeyInOrg(organizationId, storageKey);
  const expiresSeconds = expirySecondsFor(i.size);
  const urlExpiresAt = new Date(now.getTime() + expiresSeconds * 1000);

  let put: { url: string; method: "PUT"; headers: Record<string, string> };
  if (transport === "direct") {
    const direct = getStorageProvider().presignPut({ key: storageKey, contentType: check.contentType, byteSize: i.size, expiresSeconds });
    if (!direct) return { ok: false, code: "storage_unavailable", error: "File storage can't take direct uploads right now." };
    put = { url: direct.url, method: "PUT", headers: direct.headers };
  } else {
    put = { url: `/api/uploads/${uploadId}`, method: "PUT", headers: { "content-type": check.contentType } };
  }

  await db.insert(fileUploads).values({
    id: uploadId,
    organizationId,
    userId: actor.userId,
    purpose: i.purpose,
    status: "pending",
    transport,
    storageKey,
    fileName: check.displayName,
    declaredFormat: check.format,
    contentType: check.contentType,
    declaredSize: i.size,
    origin: (i.origin || "").slice(0, 256),
    urlExpiresAt,
    purgeAfter: new Date(urlExpiresAt.getTime() + 15 * MINUTE),
  });
  await recordAudit({
    organizationId,
    actor,
    action: "file_upload.intent",
    resourceType: "file_upload",
    resourceId: uploadId,
    metadata: { purpose: i.purpose, size: i.size, format: check.format, transport },
  });
  return { ok: true, uploadId, transport, put, expiresAt: urlExpiresAt.toISOString(), maxBytes: check.maxBytes };
}

export type UploadCompleteResult =
  | { ok: true; upload: UploadView }
  | { ok: false; code: "not_found" | "not_uploaded_yet" | "rejected" | "storage_unavailable"; error: string; retryable: boolean };

/** Refuse what arrived: delete it, mark the row failed, and audit why. */
async function reject(row: FileUpload, actor: UploadActor, reason: string, detail: string): Promise<UploadCompleteResult> {
  await deleteObject(row.organizationId, row.storageKey);
  await db
    .update(fileUploads)
    .set({
      status: "failed",
      failureReason: reason,
      failureDetail: detail.slice(0, 500),
      // A second delete after the link can no longer write the key.
      purgeAfter: new Date(row.urlExpiresAt.getTime() + 5 * MINUTE),
      updatedAt: new Date(),
    })
    .where(and(eq(fileUploads.organizationId, row.organizationId), eq(fileUploads.id, row.id), eq(fileUploads.status, "pending")));
  await recordAudit({
    organizationId: row.organizationId,
    actor,
    action: "file_upload.reject",
    resourceType: "file_upload",
    resourceId: row.id,
    metadata: { reason, purpose: row.purpose },
  });
  return { ok: false, code: "rejected", error: detail || FAILURE_MESSAGES[reason] || "The upload was refused.", retryable: false };
}

/**
 * The browser says the file is up: check what storage holds against what
 * was declared and signed (exact size, type, and that the first bytes are
 * that kind of file), then mark it `stored`. Calling it again is safe.
 */
export async function completeUpload(i: { organizationId: string; actor: UploadActor; uploadId: string }): Promise<UploadCompleteResult> {
  const row = await loadOwn(i.organizationId, i.actor.userId, i.uploadId);
  if (!row) return { ok: false, code: "not_found", error: "Upload not found.", retryable: false };
  if (row.status === "stored" || row.status === "claiming" || row.status === "claimed") return { ok: true, upload: view(row) };
  if (row.status !== "pending") {
    return { ok: false, code: "rejected", error: view(row).message || "This upload can no longer be used.", retryable: false };
  }
  assertKeyInOrg(row.organizationId, row.storageKey);
  const storage = getStorageProvider();
  let head: Awaited<ReturnType<typeof storage.head>>;
  try {
    head = await storage.head(row.storageKey);
  } catch (err) {
    log.warn("[uploads]", "storage check failed", { organizationId: row.organizationId, uploadId: row.id, error: err });
    return { ok: false, code: "storage_unavailable", error: "Storage could not be checked; try again.", retryable: true };
  }
  if (!head) {
    if (row.urlExpiresAt.getTime() > Date.now()) {
      return { ok: false, code: "not_uploaded_yet", error: "The file has not reached storage yet.", retryable: true };
    }
    return reject(row, i.actor, "expired", "");
  }
  const policy = resolvePolicy(row.purpose, process.env);
  if (head.byteSize !== row.declaredSize || head.byteSize > policy.maxBytes) {
    return reject(row, i.actor, "size_mismatch", `Storage holds ${head.byteSize} bytes, but ${row.declaredSize} were declared.`);
  }
  const storedType = head.contentType.split(";")[0]!.trim().toLowerCase();
  if (storedType !== row.contentType.toLowerCase()) {
    return reject(row, i.actor, "type_mismatch", "The file was stored with a different type than its upload link allowed.");
  }
  const first = (await storage.getRange(row.storageKey, 0, 8191)) ?? new Uint8Array(0);
  const sniff = sniffFormat(first);
  if (!familyMatches(row.declaredFormat, sniff)) {
    return reject(row, i.actor, "type_mismatch", describeMismatch(row.declaredFormat, sniff));
  }

  const now = new Date();
  const updated = await db
    .update(fileUploads)
    .set({
      status: "stored",
      storedSize: head.byteSize,
      etag: head.etag,
      detectedFormat: row.declaredFormat,
      ...(sniff.contentType ? { contentType: sniff.contentType } : {}),
      storedAt: now,
      purgeAfter: new Date(now.getTime() + CLAIM_WINDOW_MS),
      updatedAt: now,
    })
    .where(and(eq(fileUploads.organizationId, row.organizationId), eq(fileUploads.id, row.id), eq(fileUploads.status, "pending")))
    .returning();
  const stored = updated[0] ?? (await loadOwn(i.organizationId, i.actor.userId, i.uploadId));
  if (!stored || stored.status === "failed") return { ok: false, code: "rejected", error: "This upload can no longer be used.", retryable: false };
  if (updated[0]) {
    await recordAudit({
      organizationId: row.organizationId,
      actor: i.actor,
      action: "file_upload.verified",
      resourceType: "file_upload",
      resourceId: row.id,
      metadata: { purpose: row.purpose, size: head.byteSize, format: row.declaredFormat },
    });
  }
  return { ok: true, upload: view(stored) };
}

export type ClaimedUpload = {
  uploadId: string;
  resourceId: string;
  storageKey: string;
  fileName: string;
  size: number;
  contentType: string;
  format: UploadFormat;
  transient: boolean;
};

function claimed(row: FileUpload): ClaimedUpload {
  return {
    uploadId: row.id,
    resourceId: row.resourceId!,
    storageKey: row.storageKey,
    fileName: row.fileName,
    size: row.storedSize ?? row.declaredSize,
    contentType: row.contentType,
    format: (row.detectedFormat || row.declaredFormat) as UploadFormat,
    transient: UPLOAD_POLICIES[row.purpose].transient,
  };
}

function purposesClaimableAs(resourceType: UploadResourceType): UploadPurpose[] {
  return UPLOAD_PURPOSES.filter((p) => UPLOAD_POLICIES[p].claimableAs.includes(resourceType));
}

/**
 * File a stored upload on a record. One conditional UPDATE moves it to
 * `claiming` and fixes the record id (the caller's, or a new one kept for
 * retries). The caller inserts its record with that id (on conflict, do
 * nothing), then calls `finishClaim`, or `releaseClaim` / `failClaim`.
 * `rerun` says a record with this id may already exist from an earlier
 * attempt; `alreadyClaimed` means the work is done.
 */
export async function claimUpload(i: {
  organizationId: string;
  userId: string;
  uploadId: string;
  resourceType: UploadResourceType;
  resourceId?: string;
}): Promise<{ ok: true; claim: ClaimedUpload; rerun: boolean } | { ok: true; alreadyClaimed: true; resourceId: string } | { ok: false; error: string }> {
  if (!UUID.test(i.uploadId)) return { ok: false, error: "Upload not found." };
  const purposes = purposesClaimableAs(i.resourceType);
  if (purposes.length === 0) return { ok: false, error: "This file can't be saved here." };
  const fresh = i.resourceId ?? randomUUID();
  const now = new Date();
  const [row] = await db
    .update(fileUploads)
    .set({
      status: "claiming",
      resourceType: i.resourceType,
      resourceId: i.resourceId ? i.resourceId : sql`coalesce(${fileUploads.resourceId}, ${fresh}::uuid)`,
      claimedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(fileUploads.organizationId, i.organizationId),
        eq(fileUploads.id, i.uploadId),
        eq(fileUploads.userId, i.userId),
        inArray(fileUploads.purpose, purposes),
        eq(fileUploads.status, "stored"),
        gt(fileUploads.purgeAfter, now),
      ),
    )
    .returning();
  if (row) return { ok: true, claim: claimed(row), rerun: row.resourceId !== fresh };

  const current = await loadOwn(i.organizationId, i.userId, i.uploadId);
  if (!current) return { ok: false, error: "Upload not found." };
  if (!purposes.includes(current.purpose)) return { ok: false, error: "This file was uploaded for something else." };
  if (current.status === "claimed" && current.resourceType === i.resourceType && current.resourceId) {
    return { ok: true, alreadyClaimed: true, resourceId: current.resourceId };
  }
  if (current.status === "claiming" && current.resourceType === i.resourceType && current.claimedAt && now.getTime() - current.claimedAt.getTime() > STALE_CLAIM_MS) {
    // An earlier attempt died mid-claim: take it over, keeping its record id.
    const [taken] = await db
      .update(fileUploads)
      .set({ claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(fileUploads.organizationId, i.organizationId),
          eq(fileUploads.id, i.uploadId),
          eq(fileUploads.status, "claiming"),
          eq(fileUploads.claimedAt, current.claimedAt),
        ),
      )
      .returning();
    if (taken) return { ok: true, claim: claimed(taken), rerun: true };
  }
  if (current.status === "claiming") return { ok: false, error: "This file is already being saved." };
  if (current.status === "stored") return { ok: false, error: FAILURE_MESSAGES.unclaimed! };
  if (current.status === "pending") return { ok: false, error: "The file has not finished uploading." };
  return { ok: false, error: view(current).message || "This upload can no longer be used." };
}

/** The record is saved: the upload is claimed. A transient file's object is deleted now. */
export async function finishClaim(i: { organizationId: string; uploadId: string }): Promise<void> {
  const [row] = await db
    .update(fileUploads)
    .set({ status: "claimed", updatedAt: new Date() })
    .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, i.uploadId), eq(fileUploads.status, "claiming")))
    .returning();
  if (!row) return;
  if (UPLOAD_POLICIES[row.purpose].transient) {
    await deleteObject(row.organizationId, row.storageKey);
    await db
      .update(fileUploads)
      .set({ purgeAfter: new Date(row.urlExpiresAt.getTime() + 5 * MINUTE), updatedAt: new Date() })
      .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, i.uploadId)));
  } else {
    await db
      .update(fileUploads)
      .set({ purgeAfter: null, updatedAt: new Date() })
      .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, i.uploadId)));
  }
}

/** The record could not be saved (a refusal, not the file's fault): back to `stored`, record id kept for a retry. */
export async function releaseClaim(i: { organizationId: string; uploadId: string }): Promise<void> {
  await db
    .update(fileUploads)
    .set({ status: "stored", updatedAt: new Date() })
    .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, i.uploadId), eq(fileUploads.status, "claiming")));
}

/** The file itself is unusable (it could not be read): fail the upload and delete the object. */
export async function failClaim(i: { organizationId: string; uploadId: string; reason: string; detail: string }): Promise<void> {
  const [row] = await db
    .update(fileUploads)
    .set({ status: "failed", failureReason: i.reason || "claim_failed", failureDetail: i.detail.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, i.uploadId), eq(fileUploads.status, "claiming")))
    .returning();
  if (!row) return;
  await deleteObject(row.organizationId, row.storageKey);
  await db
    .update(fileUploads)
    .set({ purgeAfter: new Date(Math.max(Date.now(), row.urlExpiresAt.getTime() + 5 * MINUTE)) })
    .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, i.uploadId)));
}

export type StoredUploadPreview = { uploadId: string; fileName: string; size: number; format: UploadFormat; contentType: string };

/**
 * Which of these uploads this user could file as `resourceType` right now,
 * and why the others can't, without claiming any. For a batch action that
 * checks every file before it creates anything.
 */
export async function peekStoredUploads(i: {
  organizationId: string;
  userId: string;
  uploadIds: string[];
  resourceType: UploadResourceType;
}): Promise<{ ready: StoredUploadPreview[]; bad: { uploadId: string; reason: string }[] }> {
  const ids = Array.from(new Set(i.uploadIds)).slice(0, 50);
  const valid = ids.filter((id) => UUID.test(id));
  const rows = valid.length
    ? await db
        .select()
        .from(fileUploads)
        .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.userId, i.userId), inArray(fileUploads.id, valid)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const purposes = purposesClaimableAs(i.resourceType);
  const now = Date.now();
  const ready: StoredUploadPreview[] = [];
  const bad: { uploadId: string; reason: string }[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) bad.push({ uploadId: id, reason: "Upload not found." });
    else if (!purposes.includes(row.purpose)) bad.push({ uploadId: id, reason: "This file was uploaded for something else." });
    else if (row.status !== "stored") bad.push({ uploadId: id, reason: view(row).message || "This file is not ready to save." });
    else if (!row.purgeAfter || row.purgeAfter.getTime() <= now) bad.push({ uploadId: id, reason: FAILURE_MESSAGES.unclaimed! });
    else ready.push({ uploadId: id, fileName: row.fileName, size: row.storedSize ?? row.declaredSize, format: (row.detectedFormat || row.declaredFormat) as UploadFormat, contentType: row.contentType });
  }
  return { ready, bad };
}

/** Stop an upload the user no longer wants: delete what arrived and fail the row. */
export async function cancelUpload(i: { organizationId: string; actor: UploadActor; uploadId: string }): Promise<{ ok: true }> {
  const row = await loadOwn(i.organizationId, i.actor.userId, i.uploadId);
  if (!row || (row.status !== "pending" && row.status !== "stored")) return { ok: true };
  const [cancelled] = await db
    .update(fileUploads)
    .set({
      status: "failed",
      failureReason: "cancelled",
      // The link may still write the key until it expires: delete again after.
      purgeAfter: new Date(Math.max(Date.now(), row.urlExpiresAt.getTime() + 5 * MINUTE)),
      updatedAt: new Date(),
    })
    .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, row.id), inArray(fileUploads.status, ["pending", "stored"])))
    .returning();
  if (!cancelled) return { ok: true };
  await deleteObject(row.organizationId, row.storageKey);
  await recordAudit({
    organizationId: i.organizationId,
    actor: i.actor,
    action: "file_upload.cancel",
    resourceType: "file_upload",
    resourceId: row.id,
    metadata: { purpose: row.purpose, status: row.status },
  });
  return { ok: true };
}

/** Bytes this organization has asked to upload but not yet filed or dropped, for the storage meter. */
export async function getReservedUploadBytes(organizationId: string): Promise<number> {
  const counted = UPLOAD_PURPOSES.filter((p) => UPLOAD_POLICIES[p].countsTowardQuota);
  const [row] = await db
    .select({
      bytes: sql<number>`coalesce(sum(${fileUploads.declaredSize}) filter (where (${fileUploads.status} = 'pending' and ${fileUploads.urlExpiresAt} > now()) or ${fileUploads.status} in ('stored', 'claiming')), 0)`,
    })
    .from(fileUploads)
    .where(and(eq(fileUploads.organizationId, organizationId), inArray(fileUploads.purpose, counted)));
  return Number(row?.bytes ?? 0);
}

/**
 * Read a stored file for parsing, refusing anything that is not this
 * organization's or that changed after the upload was checked: the size
 * and entity tag must match what `completeUpload` recorded. (The upload
 * link stays valid for a while after the check, so the uploader could
 * otherwise swap the file.) Files stored before the ledger have no row
 * and are read as they are.
 */
export async function getVerifiedObject(i: {
  organizationId: string;
  storagePath: string;
}): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: "gone" | "changed" | "foreign_key" }> {
  if (!isKeyInOrg(i.organizationId, i.storagePath)) {
    log.error("[uploads]", "refused to read a storage key outside the organization", { organizationId: i.organizationId });
    return { ok: false, reason: "foreign_key" };
  }
  const [ledger] = await db
    .select({ storedSize: fileUploads.storedSize, etag: fileUploads.etag })
    .from(fileUploads)
    .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.storageKey, i.storagePath)))
    .limit(1);
  const changed = (size: number, etag: string) =>
    Boolean(ledger && ((ledger.storedSize !== null && size !== ledger.storedSize) || (ledger.etag && etag && ledger.etag !== etag)));
  // Compare before downloading, so a replaced (perhaps much larger) object
  // is never read into memory; then again on what was read.
  const head = await getStorageProvider().head(i.storagePath);
  if (!head) return { ok: false, reason: "gone" };
  if (changed(head.byteSize, head.etag)) return { ok: false, reason: "changed" };
  const obj = await getStorageProvider().get(i.storagePath);
  if (!obj) return { ok: false, reason: "gone" };
  if (changed(obj.bytes.byteLength, obj.etag)) return { ok: false, reason: "changed" };
  return { ok: true, bytes: obj.bytes, contentType: obj.contentType };
}

/**
 * In the in-memory storage mode (development, previews without R2) the
 * parse runs from the bytes in hand: another server instance would not
 * find them. Undefined with real storage, where the job reads storage.
 */
export async function inlineBytesForMemoryMode(i: { organizationId: string; storagePath: string }): Promise<Uint8Array | undefined> {
  if (getStorageProvider().name !== "memory" || !isKeyInOrg(i.organizationId, i.storagePath)) return undefined;
  return (await getStorageProvider().get(i.storagePath))?.bytes;
}

export type ProxyUploadResult = { status: number; body: UploadCompleteResult | { ok: false; error: string } };

/**
 * The browser's PUT when uploads go through the app (`proxy` transport:
 * memory storage, or the operator's `UPLOAD_TRANSPORT=proxy` lever). The
 * row must be this user's, pending, proxy and unexpired; the type and the
 * declared length must match before the body is read; then the bytes are
 * stored and checked exactly as a direct upload is.
 */
export async function receiveProxyUpload(i: {
  organizationId: string;
  actor: UploadActor;
  uploadId: string;
  contentType: string;
  contentLength: number | null;
  readBody: () => Promise<Uint8Array>;
}): Promise<ProxyUploadResult> {
  const row = await loadOwn(i.organizationId, i.actor.userId, i.uploadId);
  if (!row) return { status: 404, body: { ok: false, error: "Upload not found." } };
  if (row.status !== "pending" || row.transport !== "proxy" || row.urlExpiresAt.getTime() <= Date.now()) {
    return { status: 409, body: { ok: false, error: "This upload link can no longer be used." } };
  }
  if (i.contentType.split(";")[0]!.trim().toLowerCase() !== row.contentType.toLowerCase()) {
    return { status: 415, body: { ok: false, error: "The file's type doesn't match its upload link." } };
  }
  if (i.contentLength === null) return { status: 411, body: { ok: false, error: "The upload has no length." } };
  if (i.contentLength !== row.declaredSize) return { status: 413, body: { ok: false, error: "The file's size doesn't match its upload link." } };
  const bytes = await i.readBody();
  if (bytes.byteLength !== row.declaredSize) return { status: 400, body: { ok: false, error: "The file arrived incomplete." } };
  assertKeyInOrg(row.organizationId, row.storageKey);
  await getStorageProvider().put({ key: row.storageKey, bytes, contentType: row.contentType });
  await db
    .update(fileUploads)
    .set({ putAttempts: sql`${fileUploads.putAttempts} + 1`, updatedAt: new Date() })
    .where(and(eq(fileUploads.organizationId, i.organizationId), eq(fileUploads.id, row.id)));
  const done = await completeUpload({ organizationId: i.organizationId, actor: i.actor, uploadId: row.id });
  return { status: done.ok ? 200 : 422, body: done };
}
