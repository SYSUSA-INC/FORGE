/**
 * BL-STAB-2e — Office files for tests: real zips (stored, uncompressed)
 * built with jszip, and a way to forge one part's sizes or flags in the
 * central directory, the way a zip bomb or a password-protected file
 * reads to the checker.
 */
import JSZip from "jszip";

const MARKER = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" } as const;

/** A minimal Office zip of this kind (or without its marker part), with any extra parts. */
export async function officeZip(
  kind: keyof typeof MARKER,
  opts: { omitMarker?: boolean; extra?: Record<string, string>; comment?: string } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  if (!opts.omitMarker) zip.file(MARKER[kind], '<?xml version="1.0"?><document/>');
  for (const [name, content] of Object.entries(opts.extra ?? {})) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: "STORE", comment: opts.comment });
}

/** Rewrite one part's central-directory header: its sizes or its flags. */
export function forgeEntry(zip: Uint8Array, name: string, change: { uncompressed?: number; compressed?: number; flags?: number }): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const wanted = new TextEncoder().encode(name);
  for (let p = 0; p + 46 <= out.length; p++) {
    if (view.getUint32(p, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(p + 28, true);
    const at = out.subarray(p + 46, p + 46 + nameLength);
    if (at.length !== wanted.length || !at.every((b, i) => b === wanted[i])) continue;
    if (change.flags !== undefined) view.setUint16(p + 8, change.flags, true);
    if (change.compressed !== undefined) view.setUint32(p + 20, change.compressed, true);
    if (change.uncompressed !== undefined) view.setUint32(p + 24, change.uncompressed, true);
    return out;
  }
  throw new Error(`forgeEntry: no central-directory entry named ${name}`);
}

/** The central directory and its end record, as the checker reads them from storage. */
export function directoryOf(zip: Uint8Array): { cd: Uint8Array; entries: number } {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let p = zip.length - 22; p >= 0; p--) {
    if (view.getUint32(p, true) !== 0x06054b50) continue;
    const entries = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 12, true);
    const offset = view.getUint32(p + 16, true);
    return { cd: zip.subarray(offset, offset + size), entries };
  }
  throw new Error("directoryOf: no end record");
}

type Parsed = { entries: Uint8Array[]; cdOffset: number; eocdAt: number; comment: Uint8Array };

/** The central-directory entries (raw), where the directory starts, and the end record's place. */
function parse(zip: Uint8Array): Parsed {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocdAt = -1;
  for (let p = zip.length - 22; p >= 0; p--) if (view.getUint32(p, true) === 0x06054b50) {
    eocdAt = p;
    break;
  }
  if (eocdAt < 0) throw new Error("parse: no end record");
  const count = view.getUint16(eocdAt + 10, true);
  const cdOffset = view.getUint32(eocdAt + 16, true);
  const entries: Uint8Array[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    const len = 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    entries.push(zip.slice(p, p + len));
    p += len;
  }
  const commentLength = view.getUint16(eocdAt + 20, true);
  return { entries, cdOffset, eocdAt, comment: zip.slice(eocdAt + 22, eocdAt + 22 + commentLength) };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function endRecord(entries: number, size: number, offset: number, comment: Uint8Array): Uint8Array {
  const rec = new Uint8Array(22 + comment.length);
  const v = new DataView(rec.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries, true);
  v.setUint16(10, entries, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  v.setUint16(20, comment.length, true);
  rec.set(comment, 22);
  return rec;
}

/**
 * One part's directory entry in ZIP64 form, as Excel and `zip -fz` write
 * large files: both sizes 0xFFFFFFFF in the header, the real ones in a
 * ZIP64 extra field (id 1) placed after another extra field.
 */
export function withZip64Sizes(zip: Uint8Array, name: string, sizes: { uncompressed: number; compressed: number }): Uint8Array {
  const { entries, cdOffset, comment } = parse(zip);
  const wanted = new TextEncoder().encode(name);
  const rebuilt = entries.map((e) => {
    const v = new DataView(e.buffer, e.byteOffset, e.byteLength);
    const nameLength = v.getUint16(28, true);
    const at = e.subarray(46, 46 + nameLength);
    if (at.length !== wanted.length || !at.every((b, i) => b === wanted[i])) return e;
    const extendedTime = new Uint8Array([0x55, 0x54, 5, 0, 1, 0, 0, 0, 0]); // id 0x5455, 5 bytes
    const zip64 = new Uint8Array(4 + 16);
    const z = new DataView(zip64.buffer);
    z.setUint16(0, 0x0001, true);
    z.setUint16(2, 16, true);
    z.setBigUint64(4, BigInt(sizes.uncompressed), true);
    z.setBigUint64(12, BigInt(sizes.compressed), true);
    const extraLength = v.getUint16(30, true);
    const head = e.slice(0, 46 + nameLength);
    const h = new DataView(head.buffer);
    h.setUint32(20, 0xffffffff, true);
    h.setUint32(24, 0xffffffff, true);
    h.setUint16(30, extraLength + extendedTime.length + zip64.length, true);
    return concat([head, e.subarray(46 + nameLength, 46 + nameLength + extraLength), extendedTime, zip64, e.subarray(46 + nameLength + extraLength)]);
  });
  const cd = concat(rebuilt);
  return concat([zip.subarray(0, cdOffset), cd, endRecord(rebuilt.length, cd.length, cdOffset, comment)]);
}

/** The same zip with a ZIP64 end record and locator, its classic end record saying "see ZIP64". */
export function withZip64End(zip: Uint8Array): Uint8Array {
  const { entries, cdOffset, eocdAt, comment } = parse(zip);
  const cdSize = eocdAt - cdOffset;
  const record = new Uint8Array(56);
  const r = new DataView(record.buffer);
  r.setUint32(0, 0x06064b50, true);
  r.setBigUint64(4, 44n, true);
  r.setBigUint64(24, BigInt(entries.length), true);
  r.setBigUint64(32, BigInt(entries.length), true);
  r.setBigUint64(40, BigInt(cdSize), true);
  r.setBigUint64(48, BigInt(cdOffset), true);
  const locator = new Uint8Array(20);
  const l = new DataView(locator.buffer);
  l.setUint32(0, 0x07064b50, true);
  l.setBigUint64(8, BigInt(eocdAt), true);
  l.setUint32(16, 1, true);
  const end = endRecord(0xffff, 0xffffffff, 0xffffffff, comment);
  return concat([zip.subarray(0, eocdAt), record, locator, end]);
}
