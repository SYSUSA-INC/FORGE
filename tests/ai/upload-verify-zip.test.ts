/**
 * BL-STAB-2e — an Office file's zip table of contents, read from its last
 * bytes: real files pass; a zip bomb (parts that expand far beyond their
 * size, too many or too large parts), a password-protected file, a file
 * that isn't the Office file it is named, and a damaged directory are
 * refused, each with a plain reason.
 */
import { describe, expect, it } from "vitest";
import {
  describeZipRejection,
  inspectZipDirectory,
  locateCentralDirectory,
  readZip64Eocd,
  ZIP_LIMITS,
  ZIP_TAIL_BYTES,
} from "@/lib/upload-verify";
import { directoryOf, forgeEntry, officeZip } from "../helpers/zip-fixtures";

const MiB = 1024 * 1024;
const tailOf = (zip: Uint8Array) => zip.subarray(Math.max(0, zip.length - ZIP_TAIL_BYTES));
const inspect = (zip: Uint8Array, kind: "docx" | "xlsx" | "pptx" = "docx") => {
  const { cd, entries } = directoryOf(zip);
  return inspectZipDirectory(cd, kind, entries);
};

describe("BL-STAB-2e — Office zip checks", () => {
  it("finds the directory from the file's last bytes, comment or not, and passes real files", async () => {
    for (const kind of ["docx", "xlsx", "pptx"] as const) {
      const zip = await officeZip(kind, { comment: kind === "pptx" ? "saved by a test" : undefined });
      const loc = locateCentralDirectory(tailOf(zip), zip.length);
      // The located directory is the one the file's own end record names.
      const { cd, entries } = directoryOf(zip);
      expect(loc).toEqual({ offset: cd.byteOffset - zip.byteOffset, size: cd.length, entries });
      if (!("offset" in loc)) throw new Error("not located");
      expect(inspectZipDirectory(zip.subarray(loc.offset, loc.offset + loc.size), kind, loc.entries)).toEqual({ ok: true, entries, uncompressed: expect.any(Number) });
    }
  });

  it("refuses a file that isn't the Office file it is named", async () => {
    expect(inspect(await officeZip("xlsx", { omitMarker: true }), "xlsx")).toEqual({ ok: false, reason: "missing_marker" });
    // A Word file named .xlsx.
    expect(inspect(await officeZip("docx"), "xlsx")).toEqual({ ok: false, reason: "missing_marker" });
  });

  it("refuses a password-protected file", async () => {
    expect(inspect(forgeEntry(await officeZip("docx"), "word/document.xml", { flags: 0x1 }))).toEqual({ ok: false, reason: "encrypted" });
  });

  it("refuses parts that expand far beyond their size, or too far in all", async () => {
    const base = await officeZip("docx", { extra: { "word/media/a.bin": "a", "word/media/b.bin": "b", "word/media/c.bin": "c" } });
    // One part over 512 MB.
    expect(inspect(forgeEntry(base, "word/media/a.bin", { uncompressed: 600 * MiB, compressed: 300 * MiB }))).toEqual({ ok: false, reason: "too_large" });
    // Three parts of 400 MB: over 1 GB together.
    let big = base;
    for (const n of ["a", "b", "c"]) big = forgeEntry(big, `word/media/${n}.bin`, { uncompressed: 400 * MiB, compressed: 300 * MiB });
    expect(inspect(big)).toEqual({ ok: false, reason: "too_large" });
    // 50 MB from 10 KB: a ratio over 1,000.
    expect(inspect(forgeEntry(base, "word/media/a.bin", { uncompressed: 50 * MiB, compressed: 10 * 1024 }))).toEqual({ ok: false, reason: "ratio" });
    // Under the 10 MB floor a high ratio is fine (small, very regular parts are common).
    expect(inspect(forgeEntry(base, "word/media/a.bin", { uncompressed: 9 * MiB, compressed: 1 }))).toMatchObject({ ok: true });
  });

  it("refuses too many parts and a damaged directory", async () => {
    const zip = await officeZip("docx");
    const { cd, entries } = directoryOf(zip);
    expect(inspectZipDirectory(cd, "docx", ZIP_LIMITS.maxEntries + 1)).toEqual({ ok: false, reason: "too_many_entries" });
    expect(inspectZipDirectory(cd.subarray(0, cd.length - 5), "docx", entries)).toEqual({ ok: false, reason: "truncated" });
    // The end record says one more part than the directory lists.
    expect(inspectZipDirectory(cd, "docx", entries + 1)).toEqual({ ok: false, reason: "truncated" });
    expect(locateCentralDirectory(new Uint8Array(200), 200)).toEqual({ error: "no end-of-directory record" });
    // A directory said to start past the end record.
    const lying = zip.slice();
    const view = new DataView(lying.buffer);
    view.setUint32(lying.length - 22 + 16, lying.length, true);
    expect(locateCentralDirectory(tailOf(lying), lying.length)).toEqual({ error: "directory out of range" });
  });

  it("follows a ZIP64 end record to the directory", () => {
    // [ZIP64 end record (56)] [locator (20)] [end record (22)] at the end of a 10,000-byte file.
    const size = 10_000;
    const tail = new Uint8Array(56 + 20 + 22);
    const v = new DataView(tail.buffer);
    const recordAt = size - tail.length;
    v.setUint32(0, 0x06064b50, true);
    v.setBigUint64(32, 7n, true); // entries
    v.setBigUint64(40, 900n, true); // directory size
    v.setBigUint64(48, 5_000n, true); // directory offset
    v.setUint32(56, 0x07064b50, true);
    v.setBigUint64(56 + 8, BigInt(recordAt), true);
    v.setUint32(76, 0x06054b50, true);
    v.setUint16(76 + 10, 0xffff, true);
    v.setUint32(76 + 12, 0xffffffff, true);
    v.setUint32(76 + 16, 0xffffffff, true);
    expect(locateCentralDirectory(tail, size)).toEqual({ zip64RecordOffset: recordAt });
    expect(readZip64Eocd(tail.subarray(0, 56))).toEqual({ entries: 7, size: 900, offset: 5_000 });
    expect(readZip64Eocd(new Uint8Array(56))).toEqual({ error: "bad ZIP64 record" });
  });

  it("says why, in words a person can act on", () => {
    expect(describeZipRejection("encrypted", "docx")).toMatch(/password-protected/);
    expect(describeZipRejection("missing_marker", "xlsx")).toBe("This isn't an Excel file inside. Save it again from Excel and upload that.");
    expect(describeZipRejection("missing_marker", "docx")).toBe("This isn't a Word file inside. Save it again from Word and upload that.");
    expect(describeZipRejection("ratio", "pptx")).toMatch(/expands to far more than its size.*PowerPoint/);
    expect(describeZipRejection("unreadable", "docx")).toMatch(/incomplete or damaged.*Word/);
  });
});
