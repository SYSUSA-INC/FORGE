/**
 * BL-AIX Phase 2a — finding each extracted requirement in its document:
 * word for word or not, on which page, in which part and paragraph.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  attachProvenance,
  buildSourceIndex,
  describeSource,
  locateQuote,
  pageAt,
  pageStartsFromLengths,
} from "@/lib/requirement-provenance";
import { extractPdfText } from "@/lib/solicitation-extract";
import { ucfSolicitation } from "../helpers/ucf-solicitation";

describe("BL-AIX Phase 2a — locating a quote", () => {
  const source = "C.3  The con-\ntractor SHALL provide 24/7\n   help-desk support, on site.\nOther text follows here.";
  const index = buildSourceIndex(source);

  it("finds a quote across case, punctuation, spacing and line-break hyphenation", () => {
    expect(locateQuote(index, "The contractor shall provide 24/7 help desk support on site.")).toEqual({ quote: "exact", at: source.indexOf("The") });
  });

  it("calls a reworded tail partial and a paraphrase none", () => {
    const partial = locateQuote(index, "The contractor shall provide 24/7 help-desk support at every federal facility nationwide.");
    expect(partial).toEqual({ quote: "partial", at: source.indexOf("The") });
    expect(locateQuote(index, "Round-the-clock service desk coverage is mandatory for the vendor.")).toEqual({ quote: "none" });
    expect(locateQuote(index, "On site.")).toEqual({ quote: "none" });
  });

  it("maps page starts the way pdf-parse joins and trims pages", () => {
    const pages = ["  first page", "", "third page"];
    const raw = pages.map((p) => `\n\n${p}`).join("");
    const text = raw.trim();
    const starts = pageStartsFromLengths(pages.map((p) => p.length), raw.length - raw.trimStart().length);
    expect(text.slice(starts[0]!).startsWith("first page")).toBe(true);
    expect(text.slice(starts[2]!).startsWith("third page")).toBe(true);
    expect(pageAt(starts, text.indexOf("third"))).toBe(3);
    expect(pageAt(starts, 0)).toBe(1);
    expect(pageAt(undefined, 10)).toBeUndefined();
  });
});

describe("BL-AIX Phase 2a — attaching provenance to a solicitation's requirements", () => {
  const { text, pageStarts } = ucfSolicitation();

  it("records page, part and paragraph, and flags what the document does not say", () => {
    const res = attachProvenance(
      text,
      [
        { kind: "shall", text: "The contractor shall complete transition within 30 days of award.", ref: "" },
        { kind: "shall", text: "Volume I shall not exceed 25 pages in 12-point Times New Roman.", ref: "L.5" },
        { kind: "shall", text: "The contractor shall maintain a ticket resolution rate of 95 percent.", ref: "PWS 2.1" },
        { kind: "shall", text: "Offerors must keep the proposal brief and well organised throughout.", ref: "" },
        { kind: "shall", text: "A companion clause located in its own document.", ref: "", sourceDocId: "doc-1" },
      ],
      { pageStarts },
    );
    const [transition, volume, pws, paraphrase, companion] = res.requirements;
    expect(transition!.source).toMatchObject({ quote: "exact", page: 2, section: "C", paragraph: "3.2.1" });
    expect(volume!.source).toMatchObject({ quote: "exact", page: 4, section: "L", paragraph: "L.5" });
    expect(pws!.source).toMatchObject({ quote: "exact", page: 5, section: "Attachment J-1", paragraph: "PWS 2.1" });
    expect(paraphrase!.source).toEqual({ quote: "none" });
    expect(companion!.source).toBeUndefined();
    expect(res.counts).toEqual({ exact: 3, partial: 0, none: 1 });
    expect(text.slice(transition!.source!.at!).startsWith("The contractor shall com-")).toBe(true);
  });

  it("works without page starts (Word, text) and describes the location compactly", () => {
    const [r] = attachProvenance(text, [{ kind: "shall", text: "The contractor shall deliver a monthly status report to the COR.", ref: "C.4" }]).requirements;
    expect(r!.source).toMatchObject({ quote: "exact", section: "C", paragraph: "C.4" });
    expect(r!.source!.page).toBeUndefined();
    expect(describeSource(r!.source)).toBe("§C · C.4");
    expect(describeSource({ quote: "exact", at: 5, page: 12, section: "Attachment J-1", paragraph: "PWS 2.1" })).toBe("Attachment J-1 · p. 12 · PWS 2.1");
    expect(describeSource({ quote: "none" })).toBe("");
  });
});

describe("BL-AIX Phase 2a — PDF text with page starts", () => {
  const require = createRequire(import.meta.url);
  const pdfParse = require("pdf-parse-fork") as (b: Buffer, o?: object) => Promise<{ text: string; numpages: number }>;

  it("returns exactly the text pdf-parse always produced, and a start for every page", async () => {
    const bytes = readFileSync(require.resolve("pdf-parse-fork/test/data/04-valid.pdf"));
    const plain = await pdfParse(bytes);
    const pages: string[] = [];
    await pdfParse(bytes, {
      pagerender: async (page: { pageNumber: number; getTextContent: (o: object) => Promise<{ items: { str: string; transform: number[] }[] }> }) => {
        const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
        let lastY: number | undefined;
        let t = "";
        for (const item of content.items) {
          t += lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`;
          lastY = item.transform[5];
        }
        pages[page.pageNumber - 1] = t;
        return t;
      },
    });

    const { text, pageStarts } = await extractPdfText(new Uint8Array(bytes));
    expect(text).toBe(plain.text.trim());
    expect(pageStarts).toHaveLength(plain.numpages);
    pages.forEach((p, i) => {
      const head = p.trim().slice(0, 20);
      if (head) expect(text.indexOf(head, pageStarts[i]), `page ${i + 1}`).toBeLessThanOrEqual(pageStarts[i]! + (p.length - p.trimStart().length));
    });
  });
});
