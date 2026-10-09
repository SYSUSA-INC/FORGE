/**
 * BL-AIX Phase 1e — the extraction gold set (server side).
 *
 * A platform asset: public SAM.gov RFPs and their reviewed annotations,
 * with no organization_id and no tenant data. Callers are /admin actions
 * behind requireSuperadmin(), which also own the audit trail.
 *
 * A document is added from a SAM.gov notice ID (FORGE downloads the
 * attachments and extracts their text, so a large package never passes
 * through a request body) or from pasted text. Annotations are added,
 * edited and decided by the reviewer; changing anything on an approved
 * document reopens it, so "approved" always describes what is stored.
 */
import "server-only";

import { asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { extractionGoldDocs, extractionGoldItems, type ExtractionGoldDoc, type ExtractionGoldItem, type GoldDocFile } from "@/db/schema";
import {
  canApproveGoldDoc,
  cleanGoldItem,
  findInText,
  GOLD_MAX_FILE_BYTES,
  GOLD_MAX_FILES,
  GOLD_MAX_TEXT_CHARS,
  goldProgress,
  joinGoldFiles,
  type GoldItemStatus,
  type GoldProgress,
  type TextHit,
} from "@/lib/gold-set-logic";
import { downloadSamResource, fetchSamNotice } from "@/lib/samgov";
import { missingPlatformKeyFailure, platformSamCredential } from "@/lib/samgov-key";
import { extractTextFromAny } from "@/lib/solicitation-extract";

/** Below this, a PDF has no usable text layer (a scan). */
const MIN_PDF_TEXT = 200;

type Result<T> = { ok: true } & T | { ok: false; error: string };

export type GoldDocSummary = Omit<ExtractionGoldDoc, "rawText"> & { chars: number; progress: GoldProgress };

export async function listGoldDocs(): Promise<GoldDocSummary[]> {
  const { rawText: _rawText, ...cols } = getTableColumns(extractionGoldDocs);
  void _rawText;
  const docs = await db
    .select({ ...cols, chars: sql<number>`length(${extractionGoldDocs.rawText})`.mapWith(Number) })
    .from(extractionGoldDocs)
    .orderBy(desc(extractionGoldDocs.createdAt));
  const items = await db
    .select({ docId: extractionGoldItems.docId, kind: extractionGoldItems.kind, status: extractionGoldItems.status })
    .from(extractionGoldItems);
  return docs.map((d) => ({ ...d, progress: goldProgress(items.filter((i) => i.docId === d.id)) }));
}

export async function getGoldDoc(
  id: string,
): Promise<{ doc: ExtractionGoldDoc; items: ExtractionGoldItem[]; progress: GoldProgress } | null> {
  const [doc] = await db.select().from(extractionGoldDocs).where(eq(extractionGoldDocs.id, id)).limit(1);
  if (!doc) return null;
  const items = await db
    .select()
    .from(extractionGoldItems)
    .where(eq(extractionGoldItems.docId, id))
    .orderBy(asc(extractionGoldItems.kind), asc(extractionGoldItems.position), asc(extractionGoldItems.createdAt));
  return { doc, items, progress: goldProgress(items) };
}

/** Search one document's text without sending all of it to the browser. */
export async function searchGoldDocText(docId: string, query: string): Promise<TextHit[]> {
  const [row] = await db.select({ rawText: extractionGoldDocs.rawText }).from(extractionGoldDocs).where(eq(extractionGoldDocs.id, docId)).limit(1);
  return row ? findInText(row.rawText, query) : [];
}

async function noticeTaken(noticeId: string): Promise<boolean> {
  if (!noticeId) return false;
  const [row] = await db
    .select({ id: extractionGoldDocs.id })
    .from(extractionGoldDocs)
    .where(eq(extractionGoldDocs.noticeId, noticeId))
    .limit(1);
  return !!row;
}

/** Download a notice's attachments, extract their text and store the document as a draft. */
export async function createGoldDocFromNotice(input: { noticeId: string; userId: string }): Promise<Result<{ id: string; files: GoldDocFile[] }>> {
  const noticeId = input.noticeId.trim();
  if (await noticeTaken(noticeId)) return { ok: false, error: "That notice is already in the gold set." };
  // A platform asset: FORGE's shared key, with messages for platform admins.
  const sam = platformSamCredential({ audience: "operator" });
  if (!sam) return { ok: false, error: missingPlatformKeyFailure().error };
  const found = await fetchSamNotice(sam, noticeId);
  if (!found.ok) return { ok: false, error: found.error };
  const notice = found.notice;

  const files: GoldDocFile[] = [];
  const texts: { name: string; text: string }[] = [];
  if (notice.description.trim()) {
    texts.push({ name: "Notice description", text: notice.description });
    files.push({ name: "Notice description", chars: notice.description.trim().length });
  }
  for (const link of notice.resourceLinks.slice(0, GOLD_MAX_FILES)) {
    const dl = await downloadSamResource(sam, link, GOLD_MAX_FILE_BYTES);
    if (!dl.ok) {
      files.push({ name: link.split("/").slice(-2).join("/"), chars: 0, note: dl.error });
      continue;
    }
    try {
      const { format, text } = await extractTextFromAny(dl.bytes, dl.contentType, dl.fileName);
      const note = !format
        ? "Unsupported file type; paste its text if it matters."
        : format === "pdf" && text.trim().length < MIN_PDF_TEXT
          ? "No text layer (scanned); paste its text."
          : format === "image"
            ? "Image; paste its text."
            : undefined;
      texts.push({ name: dl.fileName, text });
      files.push({ name: dl.fileName, chars: text.trim().length, ...(note ? { note } : {}) });
    } catch (err) {
      files.push({ name: dl.fileName, chars: 0, note: `Could not read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200) });
    }
  }
  if (notice.resourceLinks.length > GOLD_MAX_FILES) {
    files.push({ name: `${notice.resourceLinks.length - GOLD_MAX_FILES} more attachments`, chars: 0, note: `Only the first ${GOLD_MAX_FILES} were downloaded.` });
  }
  const joined = joinGoldFiles(texts);
  if (!joined.text.trim()) return { ok: false, error: "The notice has no readable text or attachments." };

  const [row] = await db
    .insert(extractionGoldDocs)
    .values({
      title: (notice.title || notice.solicitationNumber || noticeId).slice(0, 300),
      noticeId: notice.noticeId || noticeId,
      solicitationNumber: notice.solicitationNumber,
      sourceUrl: notice.uiLink,
      files,
      rawText: joined.text,
      notes: joined.truncated ? "Text truncated at the size limit." : "",
      createdByUserId: input.userId,
    })
    .returning({ id: extractionGoldDocs.id });
  if (!row) return { ok: false, error: "Could not store the document." };
  return { ok: true, id: row.id, files };
}

/** A document from pasted text, for packages not on SAM.gov or not readable as files. */
export async function createGoldDocFromText(input: {
  title: string;
  text: string;
  noticeId?: string;
  sourceUrl?: string;
  userId: string;
}): Promise<Result<{ id: string }>> {
  const title = input.title.trim().slice(0, 300);
  if (!title) return { ok: false, error: "Give the document a title." };
  const noticeId = (input.noticeId ?? "").trim();
  if (await noticeTaken(noticeId)) return { ok: false, error: "That notice is already in the gold set." };
  const joined = joinGoldFiles([{ name: "Pasted text", text: input.text }]);
  if (joined.text.length < 200) return { ok: false, error: "Paste the solicitation text (at least a few paragraphs)." };
  const [row] = await db
    .insert(extractionGoldDocs)
    .values({
      title,
      noticeId,
      sourceUrl: (input.sourceUrl ?? "").trim().slice(0, 500),
      files: [{ name: "Pasted text", chars: input.text.trim().length }],
      rawText: joined.text,
      notes: joined.truncated ? "Text truncated at the size limit." : "",
      createdByUserId: input.userId,
    })
    .returning({ id: extractionGoldDocs.id });
  return row ? { ok: true, id: row.id } : { ok: false, error: "Could not store the document." };
}

/** Add the text of an attachment that could not be read (a scan) to a document. */
export async function appendGoldDocText(input: { docId: string; name: string; text: string }): Promise<Result<{ chars: number }>> {
  const got = await getGoldDoc(input.docId);
  if (!got) return { ok: false, error: "Document not found." };
  const name = input.name.trim().slice(0, 200) || "Pasted attachment";
  const text = input.text.trim();
  if (text.length < 50) return { ok: false, error: "Paste the attachment's text." };
  await db
    .update(extractionGoldDocs)
    .set({
      rawText: `${got.doc.rawText}\n\n===== ${name} =====\n${text}`.slice(0, GOLD_MAX_TEXT_CHARS),
      files: [...got.doc.files, { name, chars: text.length }],
      ...reopened(got.doc),
      updatedAt: new Date(),
    })
    .where(eq(extractionGoldDocs.id, input.docId));
  return { ok: true, chars: text.length };
}

/** Any change to an approved document sends it back to review. */
function reopened(doc: Pick<ExtractionGoldDoc, "status">) {
  return doc.status === "approved" ? { status: "in_review", approvedAt: null, approvedByUserId: null } : {};
}

async function touchDoc(docId: string) {
  const [doc] = await db.select({ status: extractionGoldDocs.status }).from(extractionGoldDocs).where(eq(extractionGoldDocs.id, docId)).limit(1);
  if (!doc) return;
  await db
    .update(extractionGoldDocs)
    .set({ ...(doc.status === "draft" ? { status: "in_review" } : reopened(doc)), updatedAt: new Date() })
    .where(eq(extractionGoldDocs.id, docId));
}

/** An annotation written by the reviewer counts as approved by them. */
export async function addGoldItem(input: {
  docId: string;
  item: Parameters<typeof cleanGoldItem>[0];
  userId: string;
}): Promise<Result<{ id: string }>> {
  const clean = cleanGoldItem(input.item);
  if (!clean.ok) return clean;
  if (!(await getGoldDoc(input.docId))) return { ok: false, error: "Document not found." };
  const [row] = await db
    .insert(extractionGoldItems)
    .values({ docId: input.docId, ...clean.item, origin: "expert", status: "approved", reviewedByUserId: input.userId, reviewedAt: new Date() })
    .returning({ id: extractionGoldItems.id });
  if (!row) return { ok: false, error: "Could not add the annotation." };
  await touchDoc(input.docId);
  return { ok: true, id: row.id };
}

async function itemDoc(itemId: string): Promise<string | null> {
  const [row] = await db.select({ docId: extractionGoldItems.docId }).from(extractionGoldItems).where(eq(extractionGoldItems.id, itemId)).limit(1);
  return row?.docId ?? null;
}

/** Edit an annotation; editing is reviewing, so it becomes approved. */
export async function updateGoldItem(input: {
  itemId: string;
  item: Parameters<typeof cleanGoldItem>[0];
  userId: string;
}): Promise<Result<{ docId: string }>> {
  const clean = cleanGoldItem(input.item);
  if (!clean.ok) return clean;
  const docId = await itemDoc(input.itemId);
  if (!docId) return { ok: false, error: "Annotation not found." };
  await db
    .update(extractionGoldItems)
    .set({ ...clean.item, status: "approved", reviewedByUserId: input.userId, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(extractionGoldItems.id, input.itemId));
  await touchDoc(docId);
  return { ok: true, docId };
}

export async function decideGoldItem(input: { itemId: string; status: GoldItemStatus; userId: string }): Promise<Result<{ docId: string }>> {
  const docId = await itemDoc(input.itemId);
  if (!docId) return { ok: false, error: "Annotation not found." };
  const decided = input.status !== "proposed";
  await db
    .update(extractionGoldItems)
    .set({
      status: input.status,
      reviewedByUserId: decided ? input.userId : null,
      reviewedAt: decided ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(extractionGoldItems.id, input.itemId));
  await touchDoc(docId);
  return { ok: true, docId };
}

/** Approve a fully reviewed document as gold, or send it back to review. */
export async function setGoldDocApproved(input: { docId: string; approved: boolean; userId: string }): Promise<Result<{ progress: GoldProgress }>> {
  const got = await getGoldDoc(input.docId);
  if (!got) return { ok: false, error: "Document not found." };
  if (input.approved) {
    const can = canApproveGoldDoc(got.progress);
    if (!can.ok) return { ok: false, error: can.reason };
  }
  await db
    .update(extractionGoldDocs)
    .set(
      input.approved
        ? { status: "approved", approvedByUserId: input.userId, approvedAt: new Date(), updatedAt: new Date() }
        : { status: "in_review", approvedByUserId: null, approvedAt: null, updatedAt: new Date() },
    )
    .where(eq(extractionGoldDocs.id, input.docId));
  return { ok: true, progress: got.progress };
}

export async function deleteGoldDoc(docId: string): Promise<Result<{ title: string }>> {
  const [row] = await db.delete(extractionGoldDocs).where(eq(extractionGoldDocs.id, docId)).returning({ title: extractionGoldDocs.title });
  return row ? { ok: true, title: row.title } : { ok: false, error: "Document not found." };
}
