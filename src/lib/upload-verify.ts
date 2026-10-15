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

// ── BL-STAB-2e — Office files are zips: check their table of contents ──
//
// A .docx, .xlsx or .pptx is a zip whose central directory (at the end of
// the file) lists every part with its sizes. Read with two small ranged
// reads (never the whole file), it shows a file built to overload a
// reader (a "zip bomb": tiny on disk, gigabytes once expanded), a
// password-protected file, or one that isn't the Office file it is named.
// A bomb that lies in its own directory can't be caught here; the read
// budget and the background job bound that case.

/** The end-of-directory record, the largest comment, and the ZIP64 locator before it. */
export const ZIP_TAIL_BYTES = 22 + 65_535 + 20;
/** A central directory larger than this is refused rather than read. */
export const ZIP_MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;
export const ZIP_LIMITS = {
  maxEntries: 20_000,
  maxTotalUncompressed: 1024 * 1024 * 1024,
  maxEntryUncompressed: 512 * 1024 * 1024,
  /** Expansion ratio allowed for parts over `ratioFloorBytes`. */
  maxRatio: 1_000,
  ratioFloorBytes: 10 * 1024 * 1024,
};
const OFFICE_MARKER: Record<"docx" | "xlsx" | "pptx", string> = {
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml",
  pptx: "ppt/presentation.xml",
};

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 2 ** 32;

export type ZipDirectoryLocation = { offset: number; size: number; entries: number };

/**
 * Find the central directory from the last bytes of a zip (`tail`, the
 * final `tail.length` bytes of an object of `objectSize`). A ZIP64 file
 * points onward to its ZIP64 record (read it, then `readZip64Eocd`).
 */
export function locateCentralDirectory(
  tail: Uint8Array,
  objectSize: number,
): ZipDirectoryLocation | { zip64RecordOffset: number } | { error: string } {
  const tailStart = objectSize - tail.length;
  // The end record is the last "PK\x05\x06" whose comment runs exactly to the end.
  for (let p = tail.length - 22; p >= 0; p--) {
    if (u32(tail, p) !== 0x06054b50 || p + 22 + u16(tail, p + 20) !== tail.length) continue;
    const entries = u16(tail, p + 10);
    const size = u32(tail, p + 12);
    const offset = u32(tail, p + 16);
    if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
      const loc = p - 20;
      if (loc < 0 || u32(tail, loc) !== 0x07064b50) return { error: "ZIP64 locator missing" };
      const recordOffset = u64(tail, loc + 8);
      if (recordOffset + 56 > tailStart + loc) return { error: "ZIP64 record out of range" };
      return { zip64RecordOffset: recordOffset };
    }
    if (offset + size > tailStart + p) return { error: "directory out of range" };
    return { offset, size, entries };
  }
  return { error: "no end-of-directory record" };
}

/** The central directory's place from a ZIP64 end record (56 bytes or more). */
export function readZip64Eocd(rec: Uint8Array): ZipDirectoryLocation | { error: string } {
  if (rec.length < 56 || u32(rec, 0) !== 0x06064b50) return { error: "bad ZIP64 record" };
  return { entries: u64(rec, 32), size: u64(rec, 40), offset: u64(rec, 48) };
}

export type ZipRejection = "encrypted" | "missing_marker" | "too_many_entries" | "too_large" | "ratio" | "truncated";

/** Check every part the central directory lists against the limits, and that it is the Office file named. */
export function inspectZipDirectory(
  cd: Uint8Array,
  expect: "docx" | "xlsx" | "pptx",
  declaredEntries?: number,
): { ok: true; entries: number; uncompressed: number } | { ok: false; reason: ZipRejection } {
  if (declaredEntries !== undefined && declaredEntries > ZIP_LIMITS.maxEntries) return { ok: false, reason: "too_many_entries" };
  const names = new Set<string>();
  let entries = 0;
  let total = 0;
  let p = 0;
  const decoder = new TextDecoder();
  while (p < cd.length) {
    if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) return { ok: false, reason: "truncated" };
    const flags = u16(cd, p + 8);
    let compressed = u32(cd, p + 20);
    let uncompressed = u32(cd, p + 24);
    const nameLength = u16(cd, p + 28);
    const extraLength = u16(cd, p + 30);
    const commentLength = u16(cd, p + 32);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > cd.length) return { ok: false, reason: "truncated" };
    // ZIP64 sizes live in the extra field (id 1), in this order, for fields set to 0xFFFFFFFF.
    let e = p + 46 + nameLength;
    while (e + 4 <= p + 46 + nameLength + extraLength) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 0x0001) {
        let f = e + 4;
        if (uncompressed === 0xffffffff && f + 8 <= e + 4 + len) {
          uncompressed = u64(cd, f);
          f += 8;
        }
        if (compressed === 0xffffffff && f + 8 <= e + 4 + len) compressed = u64(cd, f);
      }
      e += 4 + len;
    }
    entries++;
    if (entries > ZIP_LIMITS.maxEntries) return { ok: false, reason: "too_many_entries" };
    if (flags & 0x1) return { ok: false, reason: "encrypted" };
    if (uncompressed > ZIP_LIMITS.maxEntryUncompressed) return { ok: false, reason: "too_large" };
    total += uncompressed;
    if (total > ZIP_LIMITS.maxTotalUncompressed) return { ok: false, reason: "too_large" };
    if (uncompressed > ZIP_LIMITS.ratioFloorBytes && uncompressed > compressed * ZIP_LIMITS.maxRatio) return { ok: false, reason: "ratio" };
    names.add(decoder.decode(cd.subarray(p + 46, p + 46 + nameLength)));
    p = end;
  }
  if (declaredEntries !== undefined && entries !== declaredEntries) return { ok: false, reason: "truncated" };
  if (!names.has("[Content_Types].xml") || !names.has(OFFICE_MARKER[expect])) return { ok: false, reason: "missing_marker" };
  return { ok: true, entries, uncompressed: total };
}

/** What to tell the person about a refused Office file. */
export function describeZipRejection(reason: ZipRejection | "unreadable", declared: "docx" | "xlsx" | "pptx"): string {
  const app = declared === "docx" ? "Word" : declared === "xlsx" ? "Excel" : "PowerPoint";
  switch (reason) {
    case "encrypted":
      return "This file is password-protected. Remove the password and upload it again.";
    case "missing_marker":
      return `This isn't ${app === "Excel" ? "an" : "a"} ${app} file inside. Save it again from ${app} and upload that.`;
    case "too_many_entries":
    case "too_large":
    case "ratio":
      return `This file expands to far more than its size (it may be damaged, or built to overload readers). Save it again from ${app} and upload that.`;
    default:
      return `This file is incomplete or damaged. Save it again from ${app} and upload that.`;
  }
}
