/**
 * BL-STAB-2b — what an uploaded file really is, from its first bytes.
 *
 * The name and the browser's type are claims; the bytes are not. After a
 * browser uploads straight to storage, the server reads the first 8 KB
 * and checks they match the format the name declared: a PDF is a PDF, an
 * Office file is a zip, an image is an image, text is text. Executables,
 * HTML and SVG (which can carry script) and older binary Office files are
 * refused whatever they are called. Pure.
 */
import type { UploadFormat } from "@/lib/upload-policy";

export type Sniff = {
  family: UploadFormat | "zip" | "ole2" | "html" | "svg" | "executable" | "unknown";
  /** For images, the type the bytes show. */
  contentType?: string;
};

function startsWith(head: Uint8Array, bytes: number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

function ascii(head: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...head.subarray(start, start + length));
}

/** Where `needle` (ASCII) first appears in the first `within` bytes, or -1. */
function indexOfAscii(head: Uint8Array, needle: string, within: number): number {
  const limit = Math.min(head.length - needle.length, within);
  outer: for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) if (head[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** The text at the start of a file, lower-cased, after a BOM and leading whitespace. */
function leadingText(head: Uint8Array): string {
  let start = startsWith(head, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (start < head.length && (head[start] === 0x20 || head[start] === 0x09 || head[start] === 0x0a || head[start] === 0x0d)) start++;
  return ascii(head, start, 512).toLowerCase();
}

/**
 * Text in any common encoding: UTF-16 with a byte-order mark, or a
 * single-byte or UTF-8 text with no NUL bytes and almost no control
 * characters. Not UTF-8 only: CSV and TXT files saved from Excel on
 * Windows are usually Windows-1252 (curly quotes, en dashes).
 */
function looksLikeText(head: Uint8Array): boolean {
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return true;
  if (head.includes(0)) return false;
  let control = 0;
  for (const b of head) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) control++;
  }
  return control <= Math.max(1, head.length * 0.01);
}

/** What the first bytes of a file show it to be. */
export function sniffFormat(head: Uint8Array): Sniff {
  if (startsWith(head, [0x4d, 0x5a]) || startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return { family: "executable" };
  if (
    startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xca, 0xfe, 0xba, 0xbe])
  ) {
    return { family: "executable" };
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { family: "ole2" };
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return { family: "zip" };
  // A PDF may carry a little junk before its header.
  if (indexOfAscii(head, "%PDF-", 1024) >= 0) return { family: "pdf" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { family: "image", contentType: "image/png" };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { family: "image", contentType: "image/jpeg" };
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return { family: "image", contentType: "image/gif" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return { family: "image", contentType: "image/webp" };

  const lead = leadingText(head);
  if (/^<(!doctype\s+html|html|head|body|script|iframe)\b/.test(lead)) return { family: "html" };
  if (/^<svg\b/.test(lead) || (/^<\?xml\b/.test(lead) && lead.includes("<svg"))) return { family: "svg" };
  if (looksLikeText(head)) return { family: "text" };
  return { family: "unknown" };
}

/** Whether the bytes fit the format the file was declared as. */
export function familyMatches(declared: UploadFormat, sniff: Sniff): boolean {
  switch (declared) {
    case "pdf":
      return sniff.family === "pdf";
    case "docx":
    case "xlsx":
    case "pptx":
      return sniff.family === "zip";
    case "image":
      return sniff.family === "image";
    case "text":
      return sniff.family === "text";
  }
}

/** A plain reason for a refused file, from what its bytes show. */
export function describeMismatch(declared: UploadFormat, sniff: Sniff): string {
  switch (sniff.family) {
    case "ole2":
      return "This is an older Office format inside. Save it as .docx, .xlsx or .pptx and upload that.";
    case "executable":
      return "This file is a program, not a document.";
    case "html":
    case "svg":
      return "This file is a web page or drawing, not a document.";
    default:
      return `The file's contents are not a ${declared === "text" ? "text file" : declared.toUpperCase()}; it may be damaged or misnamed.`;
  }
}
