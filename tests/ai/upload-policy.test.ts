/**
 * BL-STAB-2b — upload policy and file checks. Pure.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalContentType,
  expirySecondsFor,
  formatFromName,
  HARD_MAX_BYTES,
  isKeyInOrg,
  resolvePolicy,
  sanitizeDisplayName,
  uploadKeyFor,
  utf8ByteLength,
  validateUploadRequest,
} from "@/lib/upload-policy";
import { describeMismatch, familyMatches, sniffFormat } from "@/lib/upload-verify";

const ORG = "11111111-1111-4111-8111-111111111111";
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? Array.from(new TextEncoder().encode(p)) : p)));

describe("display names", () => {
  it("drop path separators, control and direction characters, and leading dots", () => {
    expect(sanitizeDisplayName("../x.pdf")).toBe("-x.pdf");
    expect(sanitizeDisplayName("a/b\\c.pdf")).toBe("a-b-c.pdf");
    expect(sanitizeDisplayName("invoice‮fdp.exe")).toBe("invoicefdp.exe");
    expect(sanitizeDisplayName("na\u0000me.txt")).toBe("name.txt");
    expect(sanitizeDisplayName("   ")).toBe("file");
    expect(sanitizeDisplayName(".hidden.pdf")).toBe("hidden.pdf");
  });

  it("stay within 255 bytes and keep the extension", () => {
    const long = `${"é".repeat(300)}.pdf`;
    const clean = sanitizeDisplayName(long);
    expect(utf8ByteLength(clean)).toBeLessThanOrEqual(255);
    expect(clean.endsWith(".pdf")).toBe(true);
  });
});

describe("formats and limits", () => {
  it("reads the format from the name; older Office formats are told apart", () => {
    expect(formatFromName("RFP.PDF")).toEqual({ ok: true, format: "pdf", ext: "pdf" });
    expect(formatFromName("qa.csv")).toEqual({ ok: true, format: "text", ext: "csv" });
    expect(formatFromName("old.doc")).toEqual({ ok: false, code: "legacy_office" });
    expect(formatFromName("tool.exe")).toEqual({ ok: false, code: "unsupported" });
    expect(canonicalContentType("text", "csv")).toBe("text/plain");
    expect(canonicalContentType("image", "png")).toBe("image/png");
  });

  it("checks format per purpose and size per policy, with the environment override clamped", () => {
    expect(validateUploadRequest({ purpose: "document", fileName: "rfp.pdf", size: 400 * 1024 * 1024 })).toMatchObject({ ok: true, format: "pdf", contentType: "application/pdf" });
    expect(validateUploadRequest({ purpose: "document", fileName: "rfp.pdf", size: 501 * 1024 * 1024 })).toMatchObject({ ok: false, code: "too_large" });
    expect(validateUploadRequest({ purpose: "document", fileName: "rfp.pdf", size: 0 })).toMatchObject({ ok: false, code: "empty" });
    expect(validateUploadRequest({ purpose: "template_docx", fileName: "t.pdf", size: 10 })).toMatchObject({ ok: false, code: "format_not_allowed" });
    expect(validateUploadRequest({ purpose: "document", fileName: "old.xls", size: 10 })).toMatchObject({ ok: false, code: "legacy_office" });
    expect(resolvePolicy("document", { UPLOAD_MAX_FILE_MB: "5000" }).maxBytes).toBe(HARD_MAX_BYTES);
    expect(resolvePolicy("document", { UPLOAD_MAX_FILE_MB: "10" }).maxBytes).toBe(10 * 1024 * 1024);
    expect(resolvePolicy("template_docx", { UPLOAD_MAX_FILE_MB: "10" }).maxBytes).toBe(50 * 1024 * 1024);
  });

  it("gives larger files longer links, up to an hour", () => {
    expect(expirySecondsFor(0)).toBe(900);
    expect(expirySecondsFor(100 * 1024 * 1024)).toBe(900 + 400);
    expect(expirySecondsFor(10 * 1024 ** 3)).toBe(3600);
  });
});

describe("keys", () => {
  it("are built from the organization and the upload id only", () => {
    expect(uploadKeyFor(ORG, "abc", false)).toBe(`org/${ORG}/uploads/abc`);
    expect(uploadKeyFor(ORG, "abc", true)).toBe(`tmp/${ORG}/uploads/abc`);
  });

  it("belong to an organization only under its own prefix, with no tricks", () => {
    expect(isKeyInOrg(ORG, `org/${ORG}/uploads/x`)).toBe(true);
    expect(isKeyInOrg(ORG, `tmp/${ORG}/uploads/x`)).toBe(true);
    expect(isKeyInOrg(ORG, `org/${ORG}/solicitation/abc/RFP Final.pdf`)).toBe(true);
    expect(isKeyInOrg(ORG, `org/22222222-2222-4222-8222-222222222222/uploads/x`)).toBe(false);
    expect(isKeyInOrg(ORG, `org/${ORG}x/uploads/x`)).toBe(false);
    expect(isKeyInOrg(ORG, `org/${ORG}/../other/x`)).toBe(false);
    expect(isKeyInOrg(ORG, `org/${ORG}//x`)).toBe(false);
    expect(isKeyInOrg(ORG, `/org/${ORG}/x`)).toBe(false);
    expect(isKeyInOrg(ORG, `org/${ORG}/a\\b`)).toBe(false);
  });
});

describe("what the bytes show", () => {
  it("recognises documents and images", () => {
    expect(sniffFormat(bytes("junk\n%PDF-1.7\n"))).toEqual({ family: "pdf" });
    expect(sniffFormat(bytes([0x50, 0x4b, 0x03, 0x04], "word/document.xml")).family).toBe("zip");
    expect(sniffFormat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ family: "image", contentType: "image/png" });
    expect(sniffFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ family: "image", contentType: "image/jpeg" });
    expect(sniffFormat(bytes("GIF89a"))).toEqual({ family: "image", contentType: "image/gif" });
    expect(sniffFormat(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toEqual({ family: "image", contentType: "image/webp" });
    expect(sniffFormat(bytes("Question 1: Is Section L.5 required?\n"))).toEqual({ family: "text" });
    expect(sniffFormat(bytes([0xef, 0xbb, 0xbf], "café"))).toEqual({ family: "text" });
    expect(sniffFormat(bytes([0xff, 0xfe, 0x41, 0x00]))).toEqual({ family: "text" });
    // A CSV saved from Excel on Windows (Windows-1252 curly quotes and an en dash).
    expect(sniffFormat(bytes("Q1,", [0x93], "Is L.5 required?", [0x94], ",Yes ", [0x96], " see M.2\r\n"))).toEqual({ family: "text" });
    expect(sniffFormat(bytes("a", [0x01, 0x02, 0x03, 0x04], "b")).family).toBe("unknown");
  });

  it("refuses programs, web pages, drawings, old Office files and binary text", () => {
    expect(sniffFormat(bytes("MZ\u0090\u0000")).family).toBe("executable");
    expect(sniffFormat(bytes([0x7f, 0x45, 0x4c, 0x46])).family).toBe("executable");
    expect(sniffFormat(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).family).toBe("ole2");
    expect(sniffFormat(bytes("  <!DOCTYPE html><html>")).family).toBe("html");
    expect(sniffFormat(bytes('<?xml version="1.0"?><svg xmlns="x">')).family).toBe("svg");
    expect(sniffFormat(bytes("abc", [0], "def")).family).toBe("unknown");
    expect(familyMatches("pdf", sniffFormat(bytes("  <!DOCTYPE html>")))).toBe(false);
    expect(familyMatches("docx", { family: "zip" })).toBe(true);
    expect(familyMatches("text", { family: "html" })).toBe(false);
    expect(describeMismatch("docx", { family: "ole2" })).toMatch(/older Office format/);
  });
});
