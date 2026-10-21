/**
 * BL-FB-CHAT-UPLOAD — documents in the section chat, pure parts: the
 * limits, which formats the chat accepts, how the prompt budget is
 * split across attachments and how each one is excerpted and rendered.
 * Unit-tested.
 */
import type { ExtractFormat } from "@/lib/text-extract";
import { acceptFor, formatFromName, formatSizeAgainst, parseBudgetBytes, UPLOAD_POLICIES, type UploadFormat } from "@/lib/upload-policy";

export const CHAT_ATTACHMENT_LIMITS = {
  /** Upload cap (BL-STAB-2f: the upload policy's, now that files go straight to storage). */
  maxBytes: UPLOAD_POLICIES.chat_attachment.maxBytes,
  /** Extracted text kept per attachment. */
  maxTextChars: 120_000,
  /** Attachments per section conversation. */
  maxPerSection: 5,
  /** Characters of attachment text the model sees per turn, all attachments together. */
  promptBudgetChars: 16_000,
} as const;

export type ChatAttachmentFormat = Exclude<ExtractFormat, "image">;

/** Images need vision OCR and belong in Knowledge import, not a chat turn. */
export function isChatAttachmentFormat(format: ExtractFormat | null): format is ChatAttachmentFormat {
  return format !== null && format !== "image";
}

export const CHAT_ATTACHMENT_ACCEPT = acceptFor("chat_attachment");

export function chatTooLargeToReadMessage(bytes: number, budget: number): string {
  const [size, limit] = formatSizeAgainst(bytes, budget);
  return `This file is ${size}; the chat reads files of this type up to ${limit}. Attach a shorter excerpt.`;
}

/** What the chat reads of each format it takes. The server passes its own (`UPLOAD_PARSE_SCALE` applies); the default is the unscaled budget. */
export type ChatReadBudgets = Partial<Record<UploadFormat, number>>;

export function chatReadBudgets(env: Record<string, string | undefined> = {}): ChatReadBudgets {
  return Object.fromEntries(UPLOAD_POLICIES.chat_attachment.formats.map((f) => [f, parseBudgetBytes(f, env)]));
}

/**
 * BL-STAB-2f — why a picked file can't be attached, said in the browser
 * before it uploads (the server checks again); null when it can go.
 */
export function chatAttachPrecheck(file: { name: string; size: number }, attached: number, budgets: ChatReadBudgets = chatReadBudgets()): string | null {
  if (attached >= CHAT_ATTACHMENT_LIMITS.maxPerSection) {
    return `Up to ${CHAT_ATTACHMENT_LIMITS.maxPerSection} documents per conversation; remove one first.`;
  }
  const named = formatFromName(file.name);
  const budget = named.ok ? budgets[named.format] : undefined;
  // Not a format the chat takes: the upload's own check says what is wrong with it.
  if (budget === undefined) return null;
  return file.size > budget ? chatTooLargeToReadMessage(file.size, budget) : null;
}

/** Characters per attachment when `count` share `total`. */
export function splitBudget(count: number, total: number): number {
  return Math.max(0, Math.floor(total / Math.max(1, count)));
}

/** The head of a text with an omission note when it was cut. */
export function excerpt(text: string, chars: number): string {
  const t = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (t.length <= chars) return t;
  const head = t.slice(0, Math.max(0, chars)).trimEnd();
  return `${head}\n[… ${t.length - head.length} more characters omitted]`;
}

export type ChatAttachmentDoc = { fileName: string; text: string };

export const ATTACHMENTS_INSTRUCTION =
  "Reference documents the author attached to this conversation (they may call them \"the attached SOW\", \"that sample\", \"the brief\"). Use them for structure, scope and vocabulary when the author asks; quote at most short phrases; never present a document's facts as this organization's unless the author says they are.";

/** The context block the chat's system prompt carries; "" when nothing is attached. */
export function renderAttachmentsBlock(
  docs: readonly ChatAttachmentDoc[],
  budget: number = CHAT_ATTACHMENT_LIMITS.promptBudgetChars,
): string {
  const list = docs.filter((d) => d.text.trim().length > 0);
  if (list.length === 0) return "";
  const per = splitBudget(list.length, budget);
  return [
    ATTACHMENTS_INSTRUCTION,
    ...list.map((d) => `### ${d.fileName || "document"} (${d.text.length.toLocaleString("en-US")} chars)\n${excerpt(d.text, per)}`),
  ].join("\n\n");
}

/** "12.3k chars" for the chip. */
export function describeChars(n: number): string {
  if (n < 1_000) return `${n} chars`;
  return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
}
