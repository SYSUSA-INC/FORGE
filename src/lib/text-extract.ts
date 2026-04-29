/**
 * Multi-format text extractors for solicitation + knowledge intake.
 *
 * Each extractor is a thin wrapper around a parser library and returns
 * plain text. The extractors are intentionally dumb — no AI, no
 * structuring; that happens downstream in the AI gateway. Keeping the
 * boundary clean lets us swap libraries without touching call sites.
 *
 * For PDF, see solicitation-extract.ts (separate file because it has
 * the vision-OCR fallback path baked in).
 */

export type ExtractFormat =
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "image"
  | "text";

const DOCX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);
const XLSX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const PPTX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);
const PDF_TYPES = new Set(["application/pdf"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Pick the right extractor for an upload. Trusts the content-type if
 * we recognize it; otherwise falls back to filename suffix because
 * browsers occasionally send "application/octet-stream" for office docs.
 */
export function detectFormat(
  contentType: string,
  fileName: string,
): ExtractFormat | null {
  const ct = (contentType || "").toLowerCase();
  if (PDF_TYPES.has(ct)) return "pdf";
  if (DOCX_TYPES.has(ct)) return "docx";
  if (XLSX_TYPES.has(ct)) return "xlsx";
  if (PPTX_TYPES.has(ct)) return "pptx";
  if (IMAGE_TYPES.has(ct)) return "image";
  if (TEXT_TYPES.has(ct)) return "text";

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) return "pptx";
  if (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif")
  ) {
    return "image";
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text";
  return null;
}

export async function extractTextFromDocx(bytes: Uint8Array): Promise<string> {
  // mammoth's extractRawText reads paragraphs only; for richer fidelity
  // we'd swap to convertToHtml + strip tags, but raw text is plenty for
  // AI extraction.
  const mammoth = (await import("mammoth")) as unknown as {
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const buf = Buffer.from(bytes);
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value ?? "").trim();
}

export async function extractTextFromXlsx(bytes: Uint8Array): Promise<string> {
  // exceljs handles .xlsx, .xlsm, and most legacy .xls. We render every
  // sheet as a TSV-ish block prefixed with the sheet name so the AI
  // can tell which tab a number came from.
  const ExcelJS = (await import("exceljs")) as unknown as {
    Workbook: new () => {
      xlsx: { load: (data: ArrayBuffer) => Promise<unknown> };
      eachSheet: (
        cb: (
          ws: {
            name: string;
            eachRow: (
              cb: (row: { values: unknown[] }, rowNum: number) => void,
            ) => void;
          },
          id: number,
        ) => void,
      ) => void;
    };
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`\n=== Sheet: ${ws.name} ===\n`);
    ws.eachRow((row) => {
      const cells = (row.values ?? [])
        .slice(1) // exceljs uses 1-indexed values
        .map((v) => stringifyCell(v));
      if (cells.some((c) => c.trim().length > 0)) {
        out.push(cells.join("\t"));
      }
    });
  });
  return out.join("\n").trim();
}

function stringifyCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();
  // exceljs returns rich-text/formula objects shaped like
  // { richText: [{text:""}] } or { formula: "...", result: 123 }
  const obj = v as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text?: string }[])
      .map((r) => r.text ?? "")
      .join("");
  }
  if ("result" in obj) return stringifyCell(obj.result);
  if ("text" in obj) return stringifyCell(obj.text);
  return "";
}

export async function extractTextFromPptx(bytes: Uint8Array): Promise<string> {
  // PPTX is a ZIP of XML. We pull every slide XML, strip the markup,
  // and concatenate. Notes slides live alongside the slides — we grab
  // those too because they often hold the speaker context.
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const slidePaths = Object.keys(zip.files)
    .filter(
      (p) =>
        (/^ppt\/slides\/slide\d+\.xml$/i.test(p) ||
          /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(p)) &&
        !zip.files[p]!.dir,
    )
    .sort();

  const out: string[] = [];
  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const text = stripPptxXml(xml);
    if (text.trim()) {
      out.push(`\n=== ${path.replace(/^ppt\//, "")} ===\n${text}`);
    }
  }
  return out.join("\n").trim();
}

function stripPptxXml(xml: string): string {
  // PPTX text lives in <a:t>…</a:t> runs. Pull them in document order.
  const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
  return matches
    .map((m) => m.replace(/<[^>]+>/g, ""))
    .map((t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractTextFromPlainText(
  bytes: Uint8Array,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
}
