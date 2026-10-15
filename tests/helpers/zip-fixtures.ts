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
