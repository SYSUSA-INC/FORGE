/**
 * BL-FB-CHAT-UPLOAD — documents in the section chat, server side.
 *
 * A file dropped into a section's chat is reduced to its text and kept
 * with that section's conversation: the chat reads it as reference,
 * the Brain never sees it, and "Save to Knowledge" is the one way out
 * (a text-only artifact, embedded like a pasted one). Every query
 * carries organizationId. Server-only; callers own auth.
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
import { CHAT_ATTACHMENT_LIMITS, isChatAttachmentFormat } from "@/lib/chat-attachments-logic";
import { embedArtifact } from "@/lib/knowledge-artifact-embed";
import { log } from "@/lib/log";
import { extractTextFromAny } from "@/lib/solicitation-extract";
import { detectFormat, type ExtractFormat } from "@/lib/text-extract";

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

export type AttachResult = { ok: true; attachment: ChatAttachmentView } | { ok: false; error: string };

export async function attachChatDocument(input: {
  organizationId: string;
  sectionId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  actor: Actor;
}): Promise<AttachResult> {
  const { organizationId } = input;
  const fileName = input.fileName.trim().slice(0, 256) || "document";
  if (input.bytes.length === 0) return { ok: false, error: "File is empty." };
  if (input.bytes.length > CHAT_ATTACHMENT_LIMITS.maxBytes) {
    return { ok: false, error: `File is larger than ${CHAT_ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB.` };
  }
  const section = await sectionForOrg(organizationId, input.sectionId);
  if (!section) return { ok: false, error: "Section not found." };

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sectionChatAttachments)
    .where(and(eq(sectionChatAttachments.organizationId, organizationId), eq(sectionChatAttachments.sectionId, input.sectionId)));
  if (Number(n) >= CHAT_ATTACHMENT_LIMITS.maxPerSection) {
    return { ok: false, error: `Up to ${CHAT_ATTACHMENT_LIMITS.maxPerSection} documents per conversation; remove one first.` };
  }

  const format = detectFormat(input.contentType, fileName);
  if (!isChatAttachmentFormat(format)) {
    return { ok: false, error: "Attach a PDF, Word, Excel, PowerPoint or text file. Images go through Knowledge import." };
  }
  let text = "";
  try {
    text = (await extractTextFromAny(input.bytes, input.contentType, fileName)).text;
  } catch (err) {
    log.warn("[chat-attachments]", "extraction failed", { organizationId, fileName, error: err });
    return { ok: false, error: "Could not read this file." };
  }
  const clean = text.replace(/\u0000/g, "").trim().slice(0, CHAT_ATTACHMENT_LIMITS.maxTextChars);
  if (!clean) return { ok: false, error: "No readable text in this file." };

  const [row] = await db
    .insert(sectionChatAttachments)
    .values({
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
    .returning({ id: sectionChatAttachments.id, createdAt: sectionChatAttachments.createdAt, contentType: sectionChatAttachments.contentType });
  if (!row) return { ok: false, error: "Could not record the attachment." };

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "section_chat.attach",
    resourceType: "proposal_section",
    resourceId: input.sectionId,
    metadata: { proposalId: section.proposalId, attachmentId: row.id, fileName, fileSize: input.bytes.length, chars: clean.length },
  });
  return {
    ok: true,
    attachment: {
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

export async function listChatAttachments(input: { organizationId: string; sectionId: string }): Promise<ChatAttachmentView[]> {
  const { organizationId } = input;
  const rows = await db
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
    .leftJoin(users, eq(users.id, sectionChatAttachments.userId))
    .where(and(eq(sectionChatAttachments.organizationId, organizationId), eq(sectionChatAttachments.sectionId, input.sectionId)))
    .orderBy(asc(sectionChatAttachments.createdAt), asc(sectionChatAttachments.id));
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    contentType: r.contentType,
    fileSize: r.fileSize,
    chars: r.chars,
    createdAt: r.createdAt.toISOString(),
    authorName: r.authorName || r.authorEmail || null,
    savedArtifactId: r.savedArtifactId,
  }));
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
      fileSize: row.fileSize,
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
