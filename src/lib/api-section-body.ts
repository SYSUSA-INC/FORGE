import type { TipTapDoc } from "@/db/schema";
import { fromPlainText, hasPendingTrackedChanges, projectToPlain } from "@/lib/tiptap-doc";
import { renderDocToHtml } from "@/lib/tiptap-html";

/**
 * BL-16 API Slice 2b — a section's body as the API returns it: the final
 * view (pending insertions kept, pending deletions dropped), the same one
 * PDF / DOCX exports use, as plain text and as HTML, plus whether
 * suggestions are still pending. Sections saved before the rich editor
 * only have plain `content`.
 */
export function apiSectionBody(bodyDoc: TipTapDoc | null, content: string) {
  const doc = bodyDoc?.content?.length ? bodyDoc : fromPlainText(content);
  return { text: projectToPlain(doc), html: renderDocToHtml(doc), hasPendingChanges: hasPendingTrackedChanges(doc) };
}
