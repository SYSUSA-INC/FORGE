declare module "pdf-parse-fork" {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
    text: string;
  }
  function pdfParse(buffer: Buffer | Uint8Array): Promise<PdfParseResult>;
  // pdf-parse-fork uses CommonJS default export; allow either form.
  export default pdfParse;
  export = pdfParse;
}
