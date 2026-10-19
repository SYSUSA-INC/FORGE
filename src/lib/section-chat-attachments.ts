/**
 * BL-FB-CHAT-UPLOAD — documents in the section chat, server side.
 *
 * A file dropped into a section's chat is reduced to its text and kept
 * with that section's conversation: the chat reads it as reference,
 * the Brain never sees it, and "Save to Knowledge" is the one way out
 * (a text-only artifact, embedded like a pasted one). The file itself
 * reaches the server as an upload (BL-STAB-2f) and is deleted once read.
 * Every query carries organizationId. Server-only; callers own auth.
 */
import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  proposalSections,
  proposals,
  sectionChatAttachments,
  users,
  type KnowledgeArtifactKind,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { CHAT_ATTACHMENT_LIMITS, chatTooLargeToReadMessage, isChatAttachmentFormat } from "@/lib/chat-attachments-logic";
import { embedArtifact } from "@/lib/knowledge-artifact-embed";
import { log } from "@/lib/log";
import { extractTextFromAny } from "@/lib/solicitation-extract";
import { detectFormat, type ExtractFormat } from "@/lib/text-extract";
import { parseBudgetBytes, utf8ByteLength } from "@/lib/upload-policy";
import { claimUpload, failClaim, finishClaim, getVerifiedObject, releaseClaim } from "@/lib/uploads";

type Actor = { userId: string | null; email?: string | null };

export type ChatAttachmentView = {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  chars: number;
  createdAt: string;
  authorName: string | null;
  /** The Knowledge artifact this became, once saved. */
  savedArtifactId: string | null;
};

async function sectionForOrg(organizationId: string, sectionId: string): Promise<{ proposalId: string } | null> {
  const [row] = await db
    .select({ proposalId: proposalSections.proposalId })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.id, sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Why an attachment was refused: `unreadable` is the file itself (the
 * same file always fails); the others are about the conversation, so the
 * same file may attach later.
 */
export type AttachRefusal = "unreadable" | "not_found" | "limit" | "unsaved" | "busy";

export type AttachResult = { ok: true; attachment: ChatAttachmentView } | { ok: false; error: string; code: AttachRefusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function attachChatDocument(input: {
  organizationId: string;
  sectionId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  actor: Actor;
  /** BL-STAB-2f — the id an upload's claim fixed: a retry finds the row it saved instead of adding another. */
  id?: string;
  uploadId?: string;
}): Promise<AttachResult> {
  const { organizationId } = input;
  const fileName = input.fileName.trim().slice(0, 256) || "document";
  if (!UUID.test(input.sectionId)) return { ok: false, error: "Section not found.", code: "not_found" };
  if (input.id) {
    // Before the limit: a retry of the fifth attachment is not a sixth.
    const saved = await attachmentView({ organizationId, sectionId: input.sectionId, id: input.id });
    if (saved) return { ok: true, attachment: saved };
  }
  if (input.bytes.length === 0) return { ok: false, error: "File is empty.", code: "unreadable" };
  if (input.bytes.length > CHAT_ATTACHMENT_LIMITS.maxBytes) {
    return { ok: false, error: `File is larger than ${CHAT_ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB.`, code: "unreadable" };
  }
  const section = await sectionForOrg(organizationId, input.sectionId);
  if (!section) return { ok: false, error: "Section not found.", code: "not_found" };

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sectionChatAttachments)
    .where(and(eq(sectionChatAttachments.organizationId, organizationId), eq(sectionChatAttachments.sectionId, input.sectionId)));
  if (Number(n) >= CHAT_ATTACHMENT_LIMITS.maxPerSection) {
    return { ok: false, error: `Up to ${CHAT_ATTACHMENT_LIMITS.maxPerSection} documents per conversation; remove one first.`, code: "limit" };
  }

  const format = detectFormat(input.contentType, fileName);
  if (!isChatAttachmentFormat(format)) {
    return { ok: false, error: "Attach a PDF, Word, Excel, PowerPoint or text file. Images go through Knowledge import.", code: "unreadable" };
  }
  let text = "";
  try {
    text = (await extractTextFromAny(input.bytes, input.contentType, fileName)).text;
  } catch (err) {
    log.warn("[chat-attachments]", "extraction failed", { organizationId, fileName, error: err });
    return { ok: false, error: "Could not read this file.", code: "unreadable" };
  }
  const clean = text.replace(/\u0000/g, "").trim().slice(0, CHAT_ATTACHMENT_LIMITS.maxTextChars);
  if (!clean) return { ok: false, error: "No readable text in this file.", code: "unreadable" };

  const [row] = await db
    .insert(sectionChatAttachments)
    .values({
      ...(input.id ? { id: input.id } : {}),
      organizationId,
      proposalId: section.proposalId,
      sectionId: input.sectionId,
      userId: input.actor.userId,
      fileName,
      contentType: input.contentType || formatContentType(format),
      fileSize: input.bytes.length,
      text: clean,
      chars: clean.length,
    })
    .onConflictDoNothing()
    .returning({ id: sectionChatAttachments.id, createdAt: sectionChatAttachments.createdAt, contentType: sectionChatAttachments.contentType });
  if (!row) {
    // A retry of the same upload saved it first (and wrote its audit).
    const saved = input.id ? await attachmentView({ organizationId, sectionId: input.sectionId, id: input.id }) : null;
    return saved ? { ok: true, attachment: saved } : { ok: false, error: "Could not record the attachment.", code: "unsaved" };
  }

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "section_chat.attach",
    resourceType: "proposal_section",
    resourceId: input.sectionId,
    metadata: {
      proposalId: section.proposalId,
      attachmentId: row.id,
      fileName,
      fileSize: input.bytes.length,
      chars: clean.length,
      ...(input.uploadId ? { uploadId: input.uploadId } : {}),
    },
  });
  // Read back the way the list reads it, so a retry's answer is the same (it is saved either way).
  const view = await attachmentView({ organizationId, sectionId: input.sectionId, id: row.id }).catch(() => null);
  return {
    ok: true,
    attachment: view ?? {
      id: row.id,
      fileName,
      contentType: row.contentType,
      fileSize: input.bytes.length,
      chars: clean.length,
      createdAt: row.createdAt.toISOString(),
      authorName: input.actor.email ?? null,
      savedArtifactId: null,
    },
  };
}

/**
 * BL-STAB-2f — attach a file the browser uploaded straight to storage
 * (the chat's 50 MB, not a request's ~4.5 MB). The file is read once and
 * deleted; only its text is kept. A refusal about the conversation (the
 * section, the five-document limit) leaves the upload for a retry; a file
 * that can't be read is failed and deleted. A retry after a lost answer
 * returns the attachment it saved, never a second one; a save that landed
 * is reported as saved, whatever failed after it. `busy`: another request
 * is still reading this upload, so asking again later is the way on.
 */
export async function attachChatUpload(input: {
  organizationId: string;
  sectionId: string;
  uploadId: string;
  actor: { userId: string; email?: string | null };
}): Promise<AttachResult> {
  const { organizationId, sectionId } = input;
  if (!UUID.test(sectionId) || !(await sectionForOrg(organizationId, sectionId))) {
    return { ok: false, error: "Section not found.", code: "not_found" };
  }
  const claim = await claimUpload({
    organizationId,
    userId: input.actor.userId,
    uploadId: input.uploadId,
    resourceType: "section_chat_attachment",
  });
  if (!claim.ok) return { ok: false, error: claim.error, code: claim.busy ? "busy" : "unsaved" };
  if ("alreadyClaimed" in claim) {
    const saved = await attachmentView({ organizationId, sectionId, id: claim.resourceId });
    return saved
      ? { ok: true, attachment: saved }
      : { ok: false, error: "This file's attachment is not in this conversation (it was removed, or attached elsewhere); attach the file again.", code: "not_found" };
  }
  const file = claim.claim;
  const held = { organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt };
  const fail = async (error: string): Promise<AttachResult> => {
    await failClaim({ ...held, reason: "claim_failed", detail: error });
    return { ok: false, error, code: "unreadable" };
  };
  // The attachment this upload saved, if it did: then the upload is finished, never put back for a second one.
  const landed = async (): Promise<AttachResult | null> => {
    const saved = await attachmentView({ organizationId, sectionId, id: file.resourceId }).catch(() => null);
    if (!saved) return null;
    await finishClaim(held).catch((err) => log.warn("[chat-attachments]", "finishing the claim failed; the upload sweep finishes it", { organizationId, error: err }));
    return { ok: true, attachment: saved };
  };

  if (claim.rerun) {
    // An earlier attempt may have saved it and died before finishing: no second read.
    const saved = await landed();
    if (saved) return saved;
  }
  // Checked before the file is read into memory.
  const budget = parseBudgetBytes(file.format, process.env);
  if (file.size > budget) return fail(chatTooLargeToReadMessage(file.size, budget));

  let read: Awaited<ReturnType<typeof getVerifiedObject>>;
  try {
    read = await getVerifiedObject({ organizationId, storagePath: file.storageKey });
  } catch (err) {
    log.warn("[chat-attachments]", "storage read failed", { organizationId, error: err });
    await releaseClaim(held);
    return { ok: false, error: "File storage could not be reached just now. Try again in a minute.", code: "unsaved" };
  }
  if (!read.ok) {
    return fail(
      read.reason === "changed"
        ? "The stored file changed after it was uploaded; attach it again."
        : "The uploaded file is no longer in storage; attach it again.",
    );
  }

  let res: AttachResult;
  try {
    res = await attachChatDocument({
      organizationId,
      sectionId,
      id: file.resourceId,
      uploadId: file.uploadId,
      fileName: file.fileName,
      // The type the server chose for the upload, never the browser's guess.
      contentType: file.contentType,
      bytes: read.bytes,
      actor: input.actor,
    });
  } catch (err) {
    const saved = await landed();
    if (saved) return saved;
    log.error("[chat-attachments]", "attach failed", { organizationId, error: err });
    await releaseClaim(held);
    return { ok: false, error: "Could not attach the file; try again.", code: "unsaved" };
  }
  if (res.ok) {
    await finishClaim(held).catch((err) => log.warn("[chat-attachments]", "finishing the claim failed; the upload sweep finishes it", { organizationId, error: err }));
    return res;
  }
  if (res.code === "unreadable") return fail(res.error);
  // Refused for the conversation, yet another attempt at this upload may have saved it meanwhile.
  const saved = await landed();
  if (saved) return saved;
  await releaseClaim(held);
  return res;
}

function selectViews() {
  return db
    .select({
      id: sectionChatAttachments.id,
      fileName: sectionChatAttachments.fileName,
      contentType: sectionChatAttachments.contentType,
      fileSize: sectionChatAttachments.fileSize,
      chars: sectionChatAttachments.chars,
      createdAt: sectionChatAttachments.createdAt,
      savedArtifactId: sectionChatAttachments.savedArtifactId,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(sectionChatAttachments)
    .leftJoin(users, eq(users.id, sectionChatAttachments.userId));
}

function toView(r: Awaited<ReturnType<typeof selectViews>>[number]): ChatAttachmentView {
  return {
    id: r.id,
    fileName: r.fileName,
    contentType: r.contentType,
    fileSize: r.fileSize,
    chars: r.chars,
    createdAt: r.createdAt.toISOString(),
    authorName: r.authorName || r.authorEmail || null,
    savedArtifactId: r.savedArtifactId,
  };
}

async function attachmentView(input: { organizationId: string; sectionId: string; id: string }): Promise<ChatAttachmentView | null> {
  const { organizationId } = input;
  const [row] = await selectViews()
    .where(
      and(
        eq(sectionChatAttachments.organizationId, organizationId),
        eq(sectionChatAttachments.sectionId, input.sectionId),
        eq(sectionChatAttachments.id, input.id),
      ),
    )
    .limit(1);
  return row ? toView(row) : null;
}

export async function listChatAttachments(input: { organizationId: string; sectionId: string }): Promise<ChatAttachmentView[]> {
  const { organizationId } = input;
  const rows = await selectViews()
    .where(and(eq(sectionChatAttachments.organizationId, organizationId), eq(sectionChatAttachments.sectionId, input.sectionId)))
    .orderBy(asc(sectionChatAttachments.createdAt), asc(sectionChatAttachments.id));
  return rows.map(toView);
}

/** The texts the chat prompt carries, oldest first. */
export async function loadChatAttachmentTexts(input: {
  organizationId: string;
  sectionId: string;
}): Promise<{ fileName: string; text: string }[]> {
  const { organizationId } = input;
  return db
    .select({ fileName: sectionChatAttachments.fileName, text: sectionChatAttachments.text })
    .from(sectionChatAttachments)
    .where(and(eq(sectionChatAttachments.organizationId, organizationId), eq(sectionChatAttachments.sectionId, input.sectionId)))
    .orderBy(asc(sectionChatAttachments.createdAt), asc(sectionChatAttachments.id))
    .limit(CHAT_ATTACHMENT_LIMITS.maxPerSection);
}

export async function removeChatAttachment(input: {
  organizationId: string;
  attachmentId: string;
  actor: Actor;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [row] = await db
    .select({ id: sectionChatAttachments.id, sectionId: sectionChatAttachments.sectionId, proposalId: sectionChatAttachments.proposalId, fileName: sectionChatAttachments.fileName })
    .from(sectionChatAttachments)
    .where(and(eq(sectionChatAttachments.id, input.attachmentId), eq(sectionChatAttachments.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Attachment not found." };
  await db
    .delete(sectionChatAttachments)
    .where(and(eq(sectionChatAttachments.id, row.id), eq(sectionChatAttachments.organizationId, organizationId)));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "section_chat.detach",
    resourceType: "proposal_section",
    resourceId: row.sectionId,
    metadata: { proposalId: row.proposalId, attachmentId: row.id, fileName: row.fileName },
  });
  return { ok: true };
}

function formatContentType(format: ExtractFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "text/plain";
  }
}

function artifactKindFor(contentType: string, fileName: string): KnowledgeArtifactKind {
  switch (detectFormat(contentType, fileName)) {
    case "xlsx":
      return "spreadsheet";
    case "pptx":
      return "deck";
    case "text":
      return "note";
    default:
      return "other";
  }
}

/** Turn an attachment into a Knowledge artifact the Brain can search; idempotent. */
export async function saveChatAttachmentToKnowledge(input: {
  organizationId: string;
  attachmentId: string;
  actor: Actor;
}): Promise<{ ok: true; artifactId: string; embedded: boolean } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [row] = await db
    .select()
    .from(sectionChatAttachments)
    .where(and(eq(sectionChatAttachments.id, input.attachmentId), eq(sectionChatAttachments.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Attachment not found." };
  if (row.savedArtifactId) return { ok: true, artifactId: row.savedArtifactId, embedded: false };

  const [artifact] = await db
    .insert(knowledgeArtifacts)
    .values({
      organizationId,
      kind: artifactKindFor(row.contentType, row.fileName),
      source: "uploaded",
      title: row.fileName.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 256) || "Chat attachment",
      tags: ["chat-attachment"],
      fileName: row.fileName,
      // BL-STAB-2f — the bytes it holds (the text; the file was deleted once read): the storage meter counts this.
      fileSize: utf8ByteLength(row.text),
      contentType: row.contentType,
      storagePath: "",
      rawText: row.text,
      status: "indexed",
      indexedAt: new Date(),
      uploadedByUserId: row.userId ?? input.actor.userId,
      metadata: { via: "section_chat", proposalId: row.proposalId, sectionId: row.sectionId },
    })
    .returning({ id: knowledgeArtifacts.id });
  if (!artifact) return { ok: false, error: "Could not create the Knowledge artifact." };

  await db
    .update(sectionChatAttachments)
    .set({ savedArtifactId: artifact.id })
    .where(and(eq(sectionChatAttachments.id, row.id), eq(sectionChatAttachments.organizationId, organizationId)));

  let embedded = false;
  try {
    const res = await embedArtifact({ organizationId, artifactId: artifact.id });
    embedded = res.ok;
  } catch (err) {
    log.warn("[chat-attachments]", "embed after save failed", { organizationId, artifactId: artifact.id, error: err });
  }

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "section_chat.attachment.save_to_knowledge",
    resourceType: "knowledge_artifact",
    resourceId: artifact.id,
    metadata: { attachmentId: row.id, sectionId: row.sectionId, proposalId: row.proposalId, fileName: row.fileName, chars: row.chars, embedded },
  });
  return { ok: true, artifactId: artifact.id, embedded };
}

/** Clearing a chat removes its attachments too. Returns rows removed. */
export async function deleteChatAttachmentsForSection(input: { organizationId: string; sectionId: string }): Promise<number> {
  const { organizationId } = input;
  const deleted = await db
    .delete(sectionChatAttachments)
    .where(and(eq(sectionChatAttachments.organizationId, organizationId), eq(sectionChatAttachments.sectionId, input.sectionId)))
    .returning({ id: sectionChatAttachments.id });
  return deleted.length;
}
