/**
 * BL-STAB-2b — upload policy and file checks. Pure.
 */
import { describe, expect, it } from "vitest";
import {
  acceptFor,
  canonicalContentType,
  parseBudgetBytes,
  tooLargeToReadMessage,
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

describe("read budgets and pickers", () => {
  it("cap what FORGE reads automatically per format, scaled by environment but never for images", () => {
    const MiB = 1024 * 1024;
    expect(parseBudgetBytes("pdf")).toBe(150 * MiB);
    expect(parseBudgetBytes("xlsx")).toBe(40 * MiB);
    expect(parseBudgetBytes("pdf", { UPLOAD_PARSE_SCALE: "2" })).toBe(300 * MiB);
    expect(parseBudgetBytes("pdf", { UPLOAD_PARSE_SCALE: "100" })).toBe(600 * MiB);
    expect(parseBudgetBytes("image", { UPLOAD_PARSE_SCALE: "4" })).toBe(5 * MiB);
    expect(tooLargeToReadMessage(412 * MiB, 150 * MiB)).toMatch(/^Stored \(412 MB\)\. FORGE reads files of this type up to 150 MB automatically/);
  });

  it("offer only what each purpose accepts", () => {
    expect(acceptFor("template_docx")).toBe(".docx");
    expect(acceptFor("document")).toContain(".csv");
    expect(acceptFor("chat_attachment")).not.toContain(".png");
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
    // A backslash may be part of a legacy file name (old paths keep the raw name), never of the path.
    expect(isKeyInOrg(ORG, `org/${ORG}\\x/a`)).toBe(false);
    expect(isKeyInOrg(ORG, `org/${ORG}/solicitation/abc/a\\b.pdf`)).toBe(true);
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

describe("BL-STAB-2c follow-ups and BL-STAB-4", () => {
  it("reads an amendment number from a file name", async () => {
    const { amendmentNumberFromName } = await import("@/lib/amendment-name");
    expect(amendmentNumberFromName("Amendment 0003.pdf")).toBe("0003");
    expect(amendmentNumberFromName("SF30 Amendment No. 4.pdf")).toBe("4");
    expect(amendmentNumberFromName("RFP_Amd_02.docx")).toBe("02");
    expect(amendmentNumberFromName("Mod 2.pdf")).toBe("2");
    expect(amendmentNumberFromName("Modification 0001.pdf")).toBe("0001");
    expect(amendmentNumberFromName("W912DY-26-R-0042_A0002.pdf")).toBe("0002");
    expect(amendmentNumberFromName("P00003 Bilateral.pdf")).toBe("P00003");
    expect(amendmentNumberFromName("5400029248 Solicitation (1).docx")).toBe("");
    expect(amendmentNumberFromName("Section L.pdf")).toBe("");
  });

  it("lets the server's limit override the browser's default", async () => {
    const { validateUploadRequest, formatLimit } = await import("@/lib/upload-policy");
    const size = 600 * 1024 * 1024;
    expect(validateUploadRequest({ purpose: "document", fileName: "big.pdf", size })).toMatchObject({ ok: false, code: "too_large" });
    expect(validateUploadRequest({ purpose: "document", fileName: "big.pdf", size, maxBytes: 1024 * 1024 * 1024 })).toMatchObject({ ok: true });
    expect(formatLimit(500 * 1024 * 1024)).toBe("500 MB");
  });

  it("says how large a file is beside its read budget without contradicting itself, with advice that fits images", async () => {
    const { tooLargeToReadMessage } = await import("@/lib/upload-policy");
    const MiB = 1024 * 1024;
    expect(tooLargeToReadMessage(150.3 * MiB, 150 * MiB, "pdf")).toMatch(/^Stored \(150\.3 MB\)\. FORGE reads files of this type up to 150\.0 MB automatically; split it/);
    expect(tooLargeToReadMessage(412 * MiB, 150 * MiB, "pdf")).toMatch(/^Stored \(412 MB\)\. FORGE reads files of this type up to 150 MB/);
    expect(tooLargeToReadMessage(9 * MiB, 5 * MiB, "image")).toMatch(/save it smaller/);
  });

  it("accepts a backslash only in a legacy file name, never in the path", async () => {
    const { isKeyInOrg } = await import("@/lib/upload-policy");
    expect(isKeyInOrg("o1", "org/o1/solicitation/s1/a\\b.pdf")).toBe(true);
    expect(isKeyInOrg("o1", "org/o1\\x/solicitation/s1/a.pdf")).toBe(false);
    expect(isKeyInOrg("o1", "org/o1/../o2/a.pdf")).toBe(false);
  });

  it("refuses the in-memory store on any Vercel deployment", async () => {
    const { memoryStorageRefused } = await import("@/lib/storage");
    expect(memoryStorageRefused({})).toBe(false);
    expect(memoryStorageRefused({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(memoryStorageRefused({ VERCEL_ENV: "production" })).toBe(true);
  });
});
