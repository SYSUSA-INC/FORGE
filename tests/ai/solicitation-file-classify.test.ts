/**
 * BL-STAB-3 — what a file in a New Solicitation batch is, by rule: the
 * label, its confidence, the quoted evidence, and how a batch settles on
 * one base solicitation. Pure.
 */
import { describe, expect, it } from "vitest";
import { documentTypeFromName } from "@/lib/document-type-name";
import { MAX_BATCH_FILES, batchProblem, classifySolicitationFile, inAmendmentOrder, settleBatch } from "@/lib/solicitation-file-classify";

const RFP = [
  "SOLICITATION/CONTRACT/ORDER FOR COMMERCIAL PRODUCTS AND COMMERCIAL SERVICES",
  "Standard Form 1449",
  "Request for Proposal 70B01C25R00000012",
  ...Array.from({ length: 80 }, (_, i) => `C.${i + 1} The contractor shall provide the services described in paragraph ${i + 1} of this section.`),
  "SECTION L - INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS",
  "L.1 Proposals shall be submitted in three volumes.",
  "SECTION M - EVALUATION FACTORS FOR AWARD",
].join("\n");

const SF30 = [
  "AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT",
  "STANDARD FORM 30",
  "2. AMENDMENT/MODIFICATION NO. 0002",
  "The above numbered solicitation is amended as set forth in Item 14.",
  "SECTION L - INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS is replaced in full.",
].join("\n");

const QA = ["Questions and Answers", "Q1: Is the incumbent eligible to bid?", "A1: Yes.", "Q2: Will the due date move?", "A2: No, the date stands.", "Q3: Is a site visit planned?", "A3: No."].join("\n");

describe("BL-STAB-3 — a file's label from its name and text", () => {
  it("reads the solicitation from its cover form and Sections L and M, and quotes the lines", () => {
    const c = classifySolicitationFile({ fileName: "70B01C25R00000012.pdf", text: RFP });
    expect(c).toMatchObject({ label: "base", basis: "rules", weak: false });
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
    expect(c.evidence.length).toBeGreaterThan(0);
    expect(c.evidence.every((e) => e.from === "text" && RFP.includes(e.quote.replace(/…$/, "")))).toBe(true);
  });

  it("reads an amendment from the SF 30 header even when it reprints Section L, and takes its number from the form", () => {
    const c = classifySolicitationFile({ fileName: "scan_2291.pdf", text: SF30 });
    expect(c).toMatchObject({ label: "amendment", amendmentNumber: "0002", weak: false });
    expect(classifySolicitationFile({ fileName: "Amendment 0003.pdf", text: SF30 }).amendmentNumber).toBe("0003");
  });

  it("reads Q&A from answered questions, a PWS, a SOW and a CDRL from their headings", () => {
    expect(classifySolicitationFile({ fileName: "Attachment 7.docx", text: QA })).toMatchObject({ label: "qa", weak: false });
    expect(classifySolicitationFile({ fileName: "Att 2.docx", text: "PERFORMANCE WORK STATEMENT (PWS)\n1.0 Scope" }).label).toBe("pws");
    expect(classifySolicitationFile({ fileName: "Att 3.docx", text: "Statement of Objectives\n1.0 Purpose" }).label).toBe("sow");
    expect(classifySolicitationFile({ fileName: "Exhibit A.pdf", text: "CONTRACT DATA REQUIREMENTS LIST\nDD Form 1423-1" }).label).toBe("cdrl");
  });

  it("reads a pricing sheet from its price columns and a form from its form number", () => {
    const pricing = classifySolicitationFile({ fileName: "Attachment 4.xlsx", format: "xlsx", text: "CLIN\tDescription\tQuantity\tUnit Price\tExtended Price\n0001\tHelp desk\t12\t\t" });
    expect(pricing.label).toBe("pricing");
    expect(pricing.evidence[0]).toMatchObject({ from: "text" });
    expect(pricing.evidence[0]!.quote).toContain("Unit Price");
    expect(classifySolicitationFile({ fileName: "Attachment 9.pdf", text: "DISCLOSURE OF LOBBYING ACTIVITIES\nStandard Form LLL\nOMB Control Number: 4040-0013" }).label).toBe("form");
    // "Page 1 of 12" is not a form number, and the cover forms are the solicitation, not a form to file apart.
    expect(classifySolicitationFile({ fileName: "notes.txt", text: "Page 1 of 12\nGeneral notes" }).label).toBe("other");
    expect(classifySolicitationFile({ fileName: "x.pdf", text: "Standard Form 33\nSOLICITATION, OFFER AND AWARD" }).label).toBe("base");
  });

  it("labels from the name alone when there is no text, and marks thin or conflicting labels weak", () => {
    expect(classifySolicitationFile({ fileName: "Amendment 0001.pdf", text: "" })).toMatchObject({ label: "amendment", amendmentNumber: "0001", confidence: 0.6, weak: false });
    expect(classifySolicitationFile({ fileName: "RFP Volume I.pdf", text: "" })).toMatchObject({ label: "base", weak: true });
    expect(classifySolicitationFile({ fileName: "IMG_0042.png", text: "" })).toMatchObject({ label: "other", evidence: [], weak: true });
    // The name says PWS, the text is an SF 30: the text wins and the label is flagged.
    expect(classifySolicitationFile({ fileName: "PWS.pdf", text: SF30 })).toMatchObject({ label: "amendment", weak: true });
  });

  it("names the three new companion types from a file name without disturbing the old ones", () => {
    expect(documentTypeFromName("RFP Questions and Answers.pdf")).toBe("qa");
    expect(documentTypeFromName("Q&A_round2.docx")).toBe("qa");
    expect(documentTypeFromName("Pricing Template.xlsx")).toBe("pricing");
    expect(documentTypeFromName("SF LLL form.pdf")).toBe("form");
    expect(documentTypeFromName("DD254.pdf")).toBe("form");
    expect(documentTypeFromName("SF1449.pdf")).toBe("rfp");
    expect(documentTypeFromName("SF30_0003.pdf")).toBe("amendment");
    expect(documentTypeFromName("Attachment J-3 Pricing.xlsx")).toBe("j_attachment");
    expect(documentTypeFromName("DD 1423 CDRL.pdf")).toBe("cdrl");
  });
});

describe("BL-STAB-3 — settling a batch", () => {
  const file = (fileName: string, text = "") => ({ fileName, classification: classifySolicitationFile({ fileName, text }) });

  it("keeps the surest base and files the other volumes under it, saying why", () => {
    const settled = settleBatch([file("RFP Volume II.pdf"), file("RFP.pdf", RFP), file("Amendment 0001.pdf")]);
    expect(settled.map((f) => f.classification.label)).toEqual(["rfp", "base", "amendment"]);
    expect(settled[0]!.classification.evidence.at(-1)).toMatchObject({ from: "batch" });
    expect(settled[0]!.classification.evidence.at(-1)!.quote).toContain("RFP.pdf");
  });

  it("needs exactly one base and caps the batch", () => {
    expect(batchProblem([])).toMatch(/No files/);
    expect(batchProblem([{ label: "amendment" }, { label: "pws" }])).toMatch(/Mark one file as the base/);
    expect(batchProblem([{ label: "base" }, { label: "base" }])).toMatch(/Only one file/);
    expect(batchProblem([{ label: "base" }, { label: "qa" }])).toBeNull();
    expect(batchProblem([{ label: "base" as const }, ...Array.from({ length: MAX_BATCH_FILES }, () => ({ label: "other" as const }))])).toMatch(/At most/);
  });

  it("orders amendments by number, unnumbered last", () => {
    const order = inAmendmentOrder([
      { fileName: "c.pdf", amendmentNumber: "" },
      { fileName: "b.pdf", amendmentNumber: "0010" },
      { fileName: "a.pdf", amendmentNumber: "P00003" },
      { fileName: "d.pdf", amendmentNumber: "2" },
    ]);
    expect(order.map((f) => f.fileName)).toEqual(["d.pdf", "a.pdf", "b.pdf", "c.pdf"]);
  });
});
